"""
Build yearly waterlines of the Sundarbans coast from Sentinel-2 (free, no login) and save them for the app.

  pip install pystac-client rasterio numpy scipy scikit-image shapely
  python scripts/make_shorelines.py                    # 2018-2025, 60 m pixels
  python scripts/make_shorelines.py --years 2019 2023  # just a few years while testing
  python scripts/make_shorelines.py --res 30           # finer, slower

How it works
  1. For each year, find cloud-free Sentinel-2 scenes from January to March (dry season) via the Earth Search STAC catalogue.
  2. Compute MNDWI = (green - SWIR) / (green + SWIR) for every scene and AVERAGE them over the season.
     Averaging many dates smooths out the tide, so the result is a mean waterline.
  3. Water = MNDWI above the threshold. The sea is the water body connected to the southern edge of the box.
  4. Save the outline of the sea as public/data/shorelines/<year>.geojson, plus years.json with land area per year.

Honest limits: this is an indicative waterline, not a surveyed shoreline. Tides, mud, mangrove shadows and
cloud leftovers all move it by tens of metres. Treat year-to-year differences smaller than ~100 m as noise.
"""
import argparse, json, math, os, sys
import numpy as np
import rasterio
from rasterio.enums import Resampling
from rasterio.transform import from_origin
from rasterio.vrt import WarpedVRT
from scipy import ndimage as ndi
from skimage import measure
from shapely.geometry import LineString, mapping

GOOD_SCL = {2, 4, 5, 6, 7, 11}   # dark, vegetation, bare, water, low-prob cloud, snow: usable. clouds/shadow/nodata are dropped


def make_grid(bbox, res_m):
    lon0, lat0, lon1, lat1 = bbox
    res = res_m / 111320.0
    w = int(round((lon1 - lon0) / res))
    h = int(round((lat1 - lat0) / res))
    return dict(res=res, w=w, h=h, bbox=bbox, transform=from_origin(lon0, lat1, res, res))


def asset(item, *names):
    for n in names:
        if n in item.assets:
            return item.assets[n]
    raise KeyError(f"none of {names} in item assets {list(item.assets)[:12]}")


def scale_offset(a):
    try:
        rb = a.extra_fields["raster:bands"][0]
        return float(rb.get("scale", 1e-4)), float(rb.get("offset", 0.0))
    except Exception:
        return 1e-4, 0.0


def warp_read(href, grid, resampling, nodata=0):
    """Read one band, warped onto the common lon/lat grid. Returns a masked array."""
    with rasterio.open(href) as src:
        with WarpedVRT(src, crs="EPSG:4326", transform=grid["transform"], width=grid["w"], height=grid["h"],
                       resampling=resampling, nodata=nodata) as vrt:
            return vrt.read(1, masked=True)


def scene_mndwi(item, grid):
    """MNDWI for one scene on the grid, NaN where unusable."""
    g_a, s_a, c_a = asset(item, "green", "B03"), asset(item, "swir16", "B11"), asset(item, "scl", "SCL")
    g = warp_read(g_a.href, grid, Resampling.bilinear)
    s = warp_read(s_a.href, grid, Resampling.bilinear)
    c = warp_read(c_a.href, grid, Resampling.nearest)
    gs, go = scale_offset(g_a)
    ss, so = scale_offset(s_a)
    gf = g.astype("float32").filled(np.nan) * gs + go
    sf = s.astype("float32").filled(np.nan) * ss + so
    ok = ~np.ma.getmaskarray(c) & np.isin(np.ma.getdata(c), list(GOOD_SCL))
    den = gf + sf
    with np.errstate(invalid="ignore", divide="ignore"):
        m = (gf - sf) / den
    m[~ok | ~np.isfinite(m) | (den <= 0)] = np.nan
    return m


def composite(items, grid, label=""):
    """Mean MNDWI over all scenes (running sum, so memory stays small)."""
    tot = np.zeros((grid["h"], grid["w"]), "float32")
    cnt = np.zeros((grid["h"], grid["w"]), "uint16")
    used = 0
    for i, it in enumerate(items, 1):
        try:
            m = scene_mndwi(it, grid)
        except Exception as e:
            print(f"   {label} scene {i}/{len(items)} skipped: {e}")
            continue
        v = np.isfinite(m)
        tot[v] += m[v]
        cnt[v] += 1
        used += 1
        print(f"   {label} scene {i}/{len(items)} ok")
    with np.errstate(invalid="ignore", divide="ignore"):
        mean = np.where(cnt > 0, tot / np.maximum(cnt, 1), np.nan).astype("float32")
    return mean, cnt, used


def sea_mask(mean, thr, min_land_px):
    """Water connected to the southern edge = the sea. Everything else (including unknown pixels) = land."""
    water = np.nan_to_num(mean, nan=-1.0) > thr
    lab, n = ndi.label(water)
    if n == 0:
        return np.zeros_like(water)
    bottom = np.unique(lab[-5:, :])
    bottom = bottom[bottom > 0]
    if bottom.size == 0:
        return np.zeros_like(water)
    sizes = ndi.sum(water, lab, bottom)
    sea = lab == bottom[int(np.argmax(sizes))]
    # drop tiny land specks so single noisy pixels don't create islands
    land = ~sea
    llab, ln = ndi.label(land)
    if ln:
        sz = ndi.sum(land, llab, range(1, ln + 1))
        small = np.isin(llab, [i + 1 for i, s in enumerate(sz) if s < min_land_px])
        sea = sea | small
    return sea


def land_area_km2(sea, grid):
    lat_top = grid["bbox"][3]
    res = grid["res"]
    rows_lat = lat_top - (np.arange(grid["h"]) + 0.5) * res
    px_km2 = (res * 111.32 * np.cos(np.radians(rows_lat))) * (res * 110.57)
    land_rows = (~sea).sum(axis=1)
    return float((land_rows * px_km2).sum())


def sea_outline(sea, grid, min_pts=25):
    """Outline of the sea as lon/lat lines (smoothed and simplified)."""
    smooth = ndi.gaussian_filter(sea.astype("float32"), 1.0)
    lon0, _, _, lat1 = grid["bbox"]
    res = grid["res"]
    feats = []
    for c in measure.find_contours(smooth, 0.5):
        if len(c) < min_pts:
            continue
        pts = [(lon0 + (col + 0.5) * res, lat1 - (row + 0.5) * res) for row, col in c]
        line = LineString(pts).simplify(res * 0.7)
        if len(line.coords) >= 3:
            feats.append({"type": "Feature", "geometry": mapping(line), "properties": {}})
    return feats


def search_items(year, bbox, max_items, season, max_cloud):
    from pystac_client import Client
    cat = Client.open("https://earth-search.aws.element84.com/v1")
    s = cat.search(collections=["sentinel-2-l2a"], bbox=list(bbox),
                   datetime=f"{year}-{season[0]}/{year}-{season[1]}",
                   query={"eo:cloud_cover": {"lt": max_cloud}}, max_items=max_items)
    return list(s.items())


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--years", type=int, nargs="+", default=list(range(2018, 2026)))
    ap.add_argument("--bbox", default="88.0,21.2,90.0,22.8", help="lon_min,lat_min,lon_max,lat_max (must include open sea at the south edge)")
    ap.add_argument("--res", type=float, default=60, help="pixel size in metres")
    ap.add_argument("--thr", type=float, default=0.0, help="MNDWI water threshold")
    ap.add_argument("--season", default="01-01,03-31", help="start,end as MM-DD")
    ap.add_argument("--cloud", type=float, default=30)
    ap.add_argument("--max-scenes", type=int, default=60)
    ap.add_argument("--out", default="public/data/shorelines")
    a = ap.parse_args()

    bbox = tuple(float(v) for v in a.bbox.split(","))
    season = a.season.split(",")
    grid = make_grid(bbox, a.res)
    os.makedirs(a.out, exist_ok=True)
    min_land_px = max(4, int(0.05 / (a.res / 1000) ** 2))   # specks under ~0.05 km2

    years_done, areas = [], {}
    idx = os.path.join(a.out, "years.json")
    if os.path.exists(idx):
        try:
            old = json.load(open(idx))
            years_done, areas = list(old.get("years", [])), {int(k): v for k, v in old.get("land_km2", {}).items()}
        except Exception:
            pass

    env = dict(AWS_NO_SIGN_REQUEST="YES", GDAL_DISABLE_READDIR_ON_OPEN="EMPTY_DIR",
               CPL_VSIL_CURL_ALLOWED_EXTENSIONS=".tif", GDAL_HTTP_MAX_RETRY="3", GDAL_HTTP_RETRY_DELAY="1")
    with rasterio.Env(**env):
        for y in a.years:
            print(f"== {y}")
            try:
                items = search_items(y, bbox, a.max_scenes, season, a.cloud)
            except Exception as e:
                print("   search failed:", e)
                continue
            print(f"   {len(items)} scenes found")
            if len(items) < 3:
                print("   too few clear scenes, skipping this year")
                continue
            mean, cnt, used = composite(items, grid, str(y))
            cover = float((cnt > 0).mean()) * 100
            print(f"   {used} scenes used, {cover:.0f}% of the box has data")
            if used < 3 or cover < 60:
                print("   not enough coverage, skipping this year")
                continue
            sea = sea_mask(mean, a.thr, min_land_px)
            feats = sea_outline(sea, grid)
            with open(os.path.join(a.out, f"{y}.geojson"), "w") as f:
                json.dump({"type": "FeatureCollection", "features": feats}, f)
            areas[y] = round(land_area_km2(sea, grid), 1)
            if y not in years_done:
                years_done.append(y)
            print(f"   saved {y}.geojson ({len(feats)} lines), land area {areas[y]} km2")
            with open(idx, "w") as f:   # save as we go so a crash keeps finished years
                json.dump({"years": sorted(years_done), "land_km2": {str(k): areas[k] for k in sorted(areas)},
                           "source": "Sentinel-2 L2A, MNDWI mean composite", "season": a.season, "res_m": a.res}, f)
    if not years_done:
        sys.exit("No year produced a shoreline. Check your internet connection and try --years 2023 first.")
    print("done. years:", sorted(years_done))


if __name__ == "__main__":
    main()

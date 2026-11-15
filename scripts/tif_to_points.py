"""
Convert a vertical-land-motion GeoTIFF into the app's subsidence file (public/data/subsidence.geojson).

  pip install rasterio numpy
  python scripts/tif_to_points.py path/to/ganges_vlm.tif

Convention in the app: rate_mm_yr is NEGATIVE where the land is sinking (mm per year).
Check the numbers this script prints before trusting the map:
  - sinking should come out negative.   If most of the delta shows positive, rerun with --flip
  - values should be in mm/yr (a few to ten).  If they look like 0.00x, the file is in m/yr: use --scale 1000
"""
import argparse, json, os, sys
import numpy as np
import rasterio
from rasterio.warp import transform as warp_transform
from rasterio.transform import xy as pixel_xy

ap = argparse.ArgumentParser()
ap.add_argument("tif")
ap.add_argument("--out", default="public/data/subsidence.geojson")
ap.add_argument("--bbox", default="88.0,21.5,90.0,22.8", help="lon_min,lat_min,lon_max,lat_max")
ap.add_argument("--stride", type=int, default=1, help="keep every Nth pixel (raise it if the file gets too big)")
ap.add_argument("--scale", type=float, default=1.0, help="multiply values (1000 if the file is in m/yr)")
ap.add_argument("--flip", action="store_true", help="use if the file has sinking as POSITIVE")
ap.add_argument("--coh", help="optional coherence GeoTIFF on the same grid (values 0..1)")
ap.add_argument("--source", default="", help="credit text shown in the app's About tab (also marks the data as real)")
a = ap.parse_args()

lon0, lat0, lon1, lat1 = [float(v) for v in a.bbox.split(",")]

with rasterio.open(a.tif) as src:
    arr = src.read(1, masked=True).astype("float64")
    h, w = arr.shape
    print(f"file: {w} x {h} pixels, pixel size {src.res[0]:.5g} x {src.res[1]:.5g} (in the file's own units), crs {src.crs}")
    coh = None
    if a.coh:
        with rasterio.open(a.coh) as c:
            coh = c.read(1, masked=True).astype("float64")
            if coh.shape != arr.shape:
                sys.exit("coherence file must be on the same grid as the rate file")
    rows, cols = np.mgrid[0:h:a.stride, 0:w:a.stride]
    rows, cols = rows.ravel(), cols.ravel()
    xs, ys = pixel_xy(src.transform, rows, cols, offset="center")
    xs, ys = np.asarray(xs), np.asarray(ys)
    if src.crs and src.crs.to_string() not in ("EPSG:4326", "OGC:CRS84"):
        lons, lats = warp_transform(src.crs, "EPSG:4326", xs.tolist(), ys.tolist())
        lons, lats = np.asarray(lons), np.asarray(lats)
    else:
        lons, lats = xs, ys

vals = arr[rows, cols]
good = ~np.ma.getmaskarray(vals) & np.isfinite(np.ma.getdata(vals))
good &= (lons >= lon0) & (lons <= lon1) & (lats >= lat0) & (lats <= lat1)
v = np.ma.getdata(vals)[good] * a.scale * (-1 if a.flip else 1)
lo, la = lons[good], lats[good]
if coh is not None:
    cv = np.clip(np.ma.getdata(coh[rows, cols])[good], 0, 1)
else:
    cv = np.ones_like(v)

if v.size == 0:
    sys.exit("No valid pixels inside the bounding box. Check --bbox and the file's coordinate system.")

print(f"points kept: {v.size}")
print(f"rate (mm/yr, negative = sinking): min {v.min():.2f} | median {np.median(v):.2f} | max {v.max():.2f}")
print(f"share of points sinking: {100 * (v < 0).mean():.0f}%")
if np.median(v) > 0:
    print("WARNING: most points are rising. If the file stores sinking as positive, rerun with --flip.")
if np.abs(v).max() < 0.5:
    print("WARNING: values are tiny. If the file is in metres per year, rerun with --scale 1000.")

feats = [{"type": "Feature", "geometry": {"type": "Point", "coordinates": [round(float(x), 4), round(float(y), 4)]},
          "properties": {"rate_mm_yr": round(float(r), 2), "coherence": round(float(c), 2)}}
         for x, y, r, c in zip(lo, la, v, cv)]
os.makedirs(os.path.dirname(a.out) or ".", exist_ok=True)
src_note = a.source or ("GeoTIFF " + os.path.basename(a.tif))
with open(a.out, "w") as f:
    json.dump({"type": "FeatureCollection", "source": src_note, "features": feats}, f)
print("saved", a.out, f"({os.path.getsize(a.out) / 1e6:.1f} MB)")

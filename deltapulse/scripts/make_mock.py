import json, math, random, os
random.seed(7)
os.makedirs("public/data/shorelines", exist_ok=True)

def coast(lon):  # placeholder coastline, NOT the real one
    return 21.75 + 0.05 * math.sin(lon * 12)

# subsidence points (negative = land sinking, mm/yr)
feats = []
for i in range(70):
    for j in range(45):
        lon = 88.0 + i / 69
        lat = 21.6 + 0.7 * j / 44
        if lat < coast(lon):
            continue
        hot = math.exp(-((lon - 88.6) ** 2 + (lat - 21.9) ** 2) / 0.04)
        rate = -(1.5 + 7 * hot + random.uniform(0, 1.5))
        coh = max(0.05, min(0.98, 0.3 + (lat - coast(lon)) * 1.6 + random.uniform(-0.15, 0.15)))
        feats.append({"type": "Feature",
            "geometry": {"type": "Point", "coordinates": [round(lon, 4), round(lat, 4)]},
            "properties": {"rate_mm_yr": round(rate, 2), "coherence": round(coh, 2)}})
json.dump({"type": "FeatureCollection", "features": feats}, open("public/data/subsidence.geojson", "w"))

# shorelines 2015-2025, retreating inland ~0.002 deg/yr
for y in range(2015, 2026):
    shift = (y - 2015) * 0.002
    coords = [[round(88.0 + k * 0.01, 3), round(coast(88.0 + k * 0.01) + shift + 0.003 * math.sin(k + y), 4)] for k in range(101)]
    json.dump({"type": "FeatureCollection", "features": [{"type": "Feature",
        "geometry": {"type": "LineString", "coordinates": coords}, "properties": {"year": y}}]},
        open(f"public/data/shorelines/{y}.geojson", "w"))
print("done:", len(feats), "points")
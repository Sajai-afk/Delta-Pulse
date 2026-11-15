import json, os, datetime as dt
import asf_search as asf

AOI = "POLYGON((88.0 21.5, 90.0 21.5, 90.0 22.8, 88.0 22.8, 88.0 21.5))"
start = (dt.datetime.now(dt.timezone.utc) - dt.timedelta(days=60)).strftime("%Y-%m-%dT%H:%M:%SZ")

results = asf.search(dataset="NISAR", processingLevel="GCOV", intersectsWith=AOI, start=start, maxResults=100)
os.makedirs("public/data/live", exist_ok=True)
with open("public/data/live/nisar.geojson", "w") as f:
    json.dump(results.geojson(), f)
print("saved", len(results), "NISAR products")
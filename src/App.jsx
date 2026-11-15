import { useEffect, useMemo, useRef, useState } from 'react'
import maplibregl from 'maplibre-gl'
import 'maplibre-gl/dist/maplibre-gl.css'
import { LineChart, Line, BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid } from 'recharts'
import './App.css'

const DATA_IS_PLACEHOLDER = true // set to false once the real SAR results are in
const CARD_NEAR_DOT = true // false = story text sits in a fixed left column instead of beside the dot
const YEARS = Array.from({ length: 11 }, (_, i) => 2015 + i)
const C = { bg: '#0a1210', land: '#0c1513', water: '#0b1d24', teal: '#4fc2a6', blue: '#6fa8d6', parch: '#d9cfb4', muted: '#8e9a93' }
const SAT = 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}'
const HOTSPOTS = [ // approximate coordinates: verify with research teammate
  { name: 'Ghoramara', lon: 88.12, lat: 21.88 },
  { name: 'Sagar', lon: 88.06, lat: 21.74 },
  { name: 'Mousuni', lon: 88.20, lat: 21.66 },
]

const TABS = [['map', 'Map'], ['live', 'Live'], ['land', 'Subsidence'], ['coast', 'Shoreline'], ['risk', 'Risk'], ['about', 'About']]

const TITLES = {
  map: `Where the delta is moving`, land: `The ground is giving way`, coast: `A shoreline in retreat`,
  live: `The delta right now`, risk: `When land sinks as seas rise`, about: `Method & limits`,
}

// ---- live feeds ----
const LIVE_PT = { lat: 21.3, lon: 88.5 } // open water off Sagar Island: marine models need a sea point
const AOI_WKT = 'POLYGON((88.0 21.5, 90.0 21.5, 90.0 22.8, 88.0 22.8, 88.0 21.5))'
const GIBS_LAYER = 'VIIRS_NOAA20_CorrectedReflectance_TrueColor'
const gibsUrl = (d) => `https://gibs.earthdata.nasa.gov/wmts/epsg3857/best/${GIBS_LAYER}/default/${d}/GoogleMapsCompatible_Level9/{z}/{y}/{x}.jpg`
const fmt1 = (v, d = 1) => (v == null || Number.isNaN(+v) ? '–' : (+v).toFixed(d))
const signed = (v) => (v == null ? '–' : `${v >= 0 ? '+' : ''}${(+v).toFixed(2)}`)

const pad = () => (window.innerWidth >= 900 ? { left: 440, right: 0, top: 0, bottom: 0 } : { left: 0, right: 0, top: 70, bottom: 300 })
const riskOf = (r) => (r >= 9 ? { label: 'Severe', cls: 'sev' } : r >= 6 ? { label: 'High', cls: 'high' } : { label: 'Moderate', cls: 'mod' })
const tip = { background: 'rgba(10,18,16,.94)', border: '1px solid rgba(255,255,255,.1)', borderRadius: 8, fontSize: 12 }

// MOCK series: replace with a lookup in the real time-series data
function getTimeSeries(p) {
  const seed = Math.abs(Math.sin(p.lon * 91.7 + p.lat * 37.3))
  const out = []
  for (let k = 0; k <= 96; k += 2)
    out.push({ t: +(2017 + k / 12).toFixed(2), d: +((p.rate / 12) * k + Math.sin(k * 1.3 + seed * 10) * 1.2).toFixed(1) })
  return out
}

// recolour the basemap to the app theme
function themeMap(m) {
  m.getStyle().layers.forEach((l) => {
    try {
      const water = /water/.test(l.id)
      if (l.type === 'background') m.setPaintProperty(l.id, 'background-color', C.land)
      else if (l.type === 'fill') m.setPaintProperty(l.id, 'fill-color', water ? C.water : C.land)
      else if (l.type === 'line') m.setPaintProperty(l.id, 'line-color', water ? '#0f2a33' : /boundary/.test(l.id) ? '#2a3a33' : '#141a17')
      else if (l.type === 'symbol') {
        m.setPaintProperty(l.id, 'text-color', '#c9c2ad')
        m.setPaintProperty(l.id, 'text-halo-color', '#0a1210')
        m.setPaintProperty(l.id, 'text-halo-width', 1.2)
      }
    } catch (e) { /* layer without that property */ }
  })
}

/* ---------- custom controls ---------- */
function Slider({ min, max, step = 1, value, onChange, fmt = (v) => v, ticks = 5 }) {
  const [active, setActive] = useState(false)
  const pct = ((value - min) / (max - min)) * 100
  return (
    <div className={`slider ${active ? 'active' : ''}`} style={{ '--p': pct / 100 }}>
      <div className="s-ticks">{Array.from({ length: ticks }, (_, i) => <i key={i} />)}</div>
      <input type="range" min={min} max={max} step={step} value={value}
        onChange={(e) => onChange(+e.target.value)}
        onPointerDown={() => setActive(true)} onPointerUp={() => setActive(false)}
        onPointerCancel={() => setActive(false)} onBlur={() => setActive(false)} />
      <output style={{ left: `calc(${pct}% + ${(0.5 - pct / 100) * 14}px)` }}>{fmt(value)}</output>
    </div>
  )
}
function Switch({ label, on, onChange }) {
  return (
    <button role="switch" aria-checked={on} className={`switch ${on ? 'on' : ''}`} onClick={onChange}>
      <span>{label}</span><span className="track"><span className="knob" /></span>
    </button>
  )
}
const Metric = ({ label, value, unit, big }) => (
  <div className={`metric ${big ? 'big' : ''}`}><span>{label}</span><b>{value}<i>{unit}</i></b></div>
)

/* ---------- fine-line illustrations ---------- */
const ArtMangrove = () => (
  <svg viewBox="0 0 320 120" className="art" aria-hidden="true">
    <circle className="ln t" cx="278" cy="26" r="12" />
    <circle className="ln dim" cx="278" cy="26" r="20" />
    {[60, 140, 220].map((x, i) => (
      <g key={x}>
        <path className="ln t draw" pathLength="1" style={{ animationDelay: `${i * 0.25}s` }}
          d={`M${x - 28} 56 Q${x - 30} 26 ${x} 24 Q${x + 30} 26 ${x + 28} 56`} />
        <path className="ln draw" pathLength="1" style={{ animationDelay: `${i * 0.25 + 0.3}s` }}
          d={`M${x} 56 V76 M${x} 68 L${x - 15} 96 M${x} 70 L${x - 6} 96 M${x} 70 L${x + 6} 96 M${x} 68 L${x + 15} 96`} />
        <circle className="node" cx={x} cy="24" r="2.2" />
      </g>
    ))}
    <path className="ln b draw" pathLength="1" d="M0 98 Q40 92 80 98 T160 98 T240 98 T320 98" />
    <path className="ln b dim" d="M0 108 Q40 102 80 108 T160 108 T240 108 T320 108" />
  </svg>
)
const ArtSink = () => (
  <svg viewBox="0 0 320 120" className="art" aria-hidden="true">
    <path className="ln b dash" d="M0 34 H320" />
    <path className="ln t draw" pathLength="1" d="M0 56 Q60 50 120 56 T240 56 T320 54" />
    {[72, 84, 96, 108].map((y) => <path key={y} className="ln dim" d={`M0 ${y} H320`} />)}
    {[70, 160, 250].map((x, i) => (
      <g key={x}>
        <path className="ln draw" pathLength="1" style={{ animationDelay: `${i * 0.3}s` }} d={`M${x} 62 V92 M${x - 5} 86 L${x} 92 L${x + 5} 86`} />
        <circle className="node" cx={x} cy="58" r="2.2" />
      </g>
    ))}
  </svg>
)
const ArtRetreat = () => (
  <svg viewBox="0 0 320 120" className="art" aria-hidden="true">
    <path className="ln dash" d="M0 94 Q50 82 100 94 T200 94 T320 90" />
    <path className="ln t draw" pathLength="1" d="M0 72 Q50 60 100 72 T200 72 T320 68" />
    <path className="ln b dim" d="M0 108 Q60 100 120 108 T240 108 T320 106" />
    <g className="spin">
      {[8, 17, 27].map((r, i) => (
        <circle key={r} className="ln b" cx="256" cy="30" r={r} strokeDasharray={`${r * 1.6} ${r * 0.9}`} opacity={0.95 - i * 0.2} />
      ))}
    </g>
    <circle className="node" cx="256" cy="30" r="2.4" />
  </svg>
)
const ArtSpace = () => (
  <svg viewBox="0 0 320 120" className="art" aria-hidden="true">
    <path className="ln dash" d="M20 36 Q160 -8 300 36" />
    <path className="ln" d="M154 12 h12 v9 h-12 z M138 16.5 H154 M166 16.5 H182" />
    {[100, 160, 220].map((x, i) => (
      <g key={x}>
        <path className="ln t draw" pathLength="1" style={{ animationDelay: `${i * 0.25}s`, opacity: 0.55 }} d={`M160 22 L${x} ${i === 1 ? 96 : 92}`} />
        <circle className="node" cx={x} cy={i === 1 ? 96 : 92} r="2.4" />
      </g>
    ))}
    <path className="ln b draw" pathLength="1" d="M0 98 Q60 90 120 98 T240 98 T320 96" />
    <path className="ln b dim" d="M0 108 Q60 100 120 108 T240 108 T320 106" />
  </svg>
)

// story stops travel strictly left to right across the stylised map (coordinates are in the 1000x760 map space)
const STORY = [
  { dot: [130, 350], label: 'LIVING DELTA', art: ArtMangrove, eyebrow: `01 — THE LIVING DELTA`, title: `A forest between river and sea`,
    text: `The Sundarbans spreads across roughly 10,000 km² of India and Bangladesh. Its mangroves shelter the Bengal tiger, shield the coast from storms and support millions of people.`,
    detail: `Two countries · Three great rivers · UNESCO World Heritage` },
  { dot: [370, 270], label: 'SINKING LAND', art: ArtSink, eyebrow: `02 — THE GROUND BELOW`, title: `The land is sinking`,
    text: `Soft river sediment compacts under its own weight, while dams, embankments and groundwater use cut off fresh silt. Sea level rises as the ground drops, so the water can climb faster than global averages suggest.` },
  { dot: [630, 450], label: 'RETREATING COAST', art: ArtRetreat, eyebrow: `03 — THE EDGE IN MOTION`, title: `The coast is retreating`,
    text: `Cyclones such as Amphan and Yaas, plus steady erosion, pull shorelines inland. Islands like Ghoramara have been losing land for decades, and salt water is creeping into farms and wells.` },
  { dot: [870, 300], label: 'VIEW FROM SPACE', art: ArtSpace, eyebrow: `04 — THE VIEW FROM SPACE`, title: `Seen from space`,
    text: `Radar satellites see through cloud, day and night. Comparing radar images taken weeks apart, InSAR can detect ground motion of a few millimetres a year, and the same data can track the shoreline.`,
    detail: `DeltaPulse turns radar into a map you can explore` },
]
const SEGS = [
  `M130 350 C210 330 290 250 370 270`,
  `M370 270 C450 300 540 460 630 450`,
  `M630 450 C710 440 790 290 870 300`,
]

export default function App() {
  const el = useRef(null)
  const map = useRef(null)
  const [ready, setReady] = useState(false)
  const [intro, setIntro] = useState(true)
  const [leaving, setLeaving] = useState(false)
  const [landing, setLanding] = useState(true)
  const [heroOut, setHeroOut] = useState(false)
  const [storyStep, setStoryStep] = useState(0)
  const [vp, setVp] = useState({ w: window.innerWidth, h: window.innerHeight })
  const [tab, setTab] = useState('map')
  const [open, setOpen] = useState(true)
  const [year, setYear] = useState(2025)
  const [playing, setPlaying] = useState(false)
  const [minCoh, setMinCoh] = useState(0.4)
  const [sat, setSat] = useState(true) // satellite imagery on by default
  const [showSubs, setShowSubs] = useState(true)
  const [showBase, setShowBase] = useState(true)
  const [sel, setSel] = useState(null)
  const [pts, setPts] = useState([])
  const [shift, setShift] = useState([])
  const [slr, setSlr] = useState(4) // mm/yr ASSUMPTION: confirm with research teammate
  const [horizon, setHorizon] = useState(2050)
  const [live, setLive] = useState({ marine: null, wx: null, sea: [], err: false })
  const [nisar, setNisar] = useState({ status: 'loading', geo: null })
  const [liveImg, setLiveImg] = useState(true)
  const [imgDaysAgo, setImgDaysAgo] = useState(1)
  const [showNisar, setShowNisar] = useState(true)
  const imgDate = new Date(Date.now() - imgDaysAgo * 864e5).toISOString().slice(0, 10)

  useEffect(() => {
    const r = () => setVp({ w: window.innerWidth, h: window.innerHeight })
    window.addEventListener('resize', r)
    return () => window.removeEventListener('resize', r)
  }, [])

  /* ---------- map ---------- */
  useEffect(() => {
    const m = new maplibregl.Map({
      container: el.current,
      style: 'https://basemaps.cartocdn.com/gl/dark-matter-gl-style/style.json',
      center: [88.5, 21.95], zoom: 7.4,
    })
    map.current = m
    m.addControl(new maplibregl.NavigationControl(), 'top-right')
    m.on('load', () => {
      themeMap(m)
      const firstSymbol = m.getStyle().layers.find((l) => l.type === 'symbol')
      m.addSource('sat', { type: 'raster', tiles: [SAT], tileSize: 256, attribution: 'Imagery © Esri' })
      m.addLayer({ id: 'sat', type: 'raster', source: 'sat', layout: { visibility: 'none' },
        paint: { 'raster-saturation': -0.25, 'raster-brightness-max': 0.82, 'raster-contrast': 0.08 } }, firstSymbol && firstSymbol.id)
      m.addSource('subs', { type: 'geojson', data: '/data/subsidence.geojson' })
      m.addLayer({ id: 'subs', type: 'circle', source: 'subs', paint: {
        'circle-radius': ['interpolate', ['linear'], ['zoom'], 7, 3, 11, 10],
        'circle-opacity': 0.85,
        'circle-color': ['interpolate', ['linear'], ['get', 'rate_mm_yr'],
          -10, '#efe6cf', -7.5, '#d9cfb4', -5, '#4fc2a6', -2, '#2c7f86', 0, '#1d4a6e'] } })
      m.addSource('base', { type: 'geojson', data: '/data/shorelines/2015.geojson' })
      m.addLayer({ id: 'base', type: 'line', source: 'base', paint: { 'line-color': C.parch, 'line-width': 1.5, 'line-dasharray': [2, 2] } })
      m.addSource('shore', { type: 'geojson', data: '/data/shorelines/2025.geojson' })
      m.addLayer({ id: 'shore', type: 'line', source: 'shore', paint: { 'line-color': C.teal, 'line-width': 3 } })
      m.addSource('sel', { type: 'geojson', data: { type: 'FeatureCollection', features: [] } })
      m.addLayer({ id: 'sel', type: 'circle', source: 'sel', paint: {
        'circle-radius': 14, 'circle-color': 'rgba(0,0,0,0)', 'circle-stroke-color': C.parch, 'circle-stroke-width': 2 } })
      m.addSource('nisar', { type: 'geojson', data: { type: 'FeatureCollection', features: [] } })
      m.addLayer({ id: 'nisar-line', type: 'line', source: 'nisar', layout: { visibility: 'none' },
  paint: { 'line-color': C.blue, 'line-width': 1.5, 'line-dasharray': [3, 2], 'line-opacity': 0.8 } })
      m.on('click', 'subs', (e) => {
        const f = e.features[0]
        const [lon, lat] = f.geometry.coordinates
        setSel({ lon, lat, rate: +f.properties.rate_mm_yr, coh: +f.properties.coherence })
      })
      m.on('mouseenter', 'subs', () => (m.getCanvas().style.cursor = 'pointer'))
      m.on('mouseleave', 'subs', () => (m.getCanvas().style.cursor = ''))
      setReady(true)
    })

    fetch('/data/subsidence.geojson').then((r) => r.json())
      .then((g) => setPts(g.features.map((f) => ({ rate: +f.properties.rate_mm_yr, coh: +f.properties.coherence })))).catch(() => {})

    // APPROXIMATION: mean shoreline position shift in km. Replace with the team's shoreline change rate when available
    Promise.all(YEARS.map((y) => fetch(`/data/shorelines/${y}.geojson`).then((r) => r.json())))
      .then((arr) => {
        const meanLat = (g) => {
          const c = g.features.flatMap((f) => (f.geometry.type === 'LineString' ? f.geometry.coordinates
            : f.geometry.type === 'MultiLineString' ? f.geometry.coordinates.flat() : []))
          return c.length ? c.reduce((s, p) => s + p[1], 0) / c.length : 0
        }
        const base = meanLat(arr[0])
        setShift(arr.map((g, i) => ({ year: YEARS[i], km: +((meanLat(g) - base) * 111).toFixed(2) })))
      }).catch(() => {})

    return () => m.remove()
  }, [])

  const vis = (id, on) => ready && map.current.setLayoutProperty(id, 'visibility', on ? 'visible' : 'none')
  useEffect(() => { vis('sat', sat) }, [sat, ready])
  useEffect(() => { vis('subs', showSubs && !intro) }, [showSubs, intro, ready])
  useEffect(() => { vis('base', showBase && !intro) }, [showBase, intro, ready])
  useEffect(() => { vis('shore', !intro) }, [intro, ready])
  useEffect(() => { if (ready) map.current.getSource('shore').setData(`/data/shorelines/${year}.geojson`) }, [year, ready])
  useEffect(() => { if (ready) map.current.setFilter('subs', ['>=', ['get', 'coherence'], minCoh]) }, [minCoh, ready])
  useEffect(() => {
    if (!ready) return
    map.current.getSource('sel').setData({ type: 'FeatureCollection', features: sel
      ? [{ type: 'Feature', geometry: { type: 'Point', coordinates: [sel.lon, sel.lat] }, properties: {} }] : [] })
  }, [sel, ready])
  useEffect(() => {
    if (!playing) return
    const id = setInterval(() => setYear((y) => (y >= 2025 ? 2015 : y + 1)), 800)
    return () => clearInterval(id)
  }, [playing])

  useEffect(() => {
  if (!intro) return
  const k = (e) => {
    if (landing) {
      if (e.key === 'Enter' || e.key === 'ArrowRight') beginStory()
      return
    }
    if (e.key === 'ArrowRight') setStoryStep((s) => Math.min(STORY.length - 1, s + 1))
    if (e.key === 'ArrowLeft') setStoryStep((s) => Math.max(0, s - 1))
  }
  window.addEventListener('keydown', k)
  return () => window.removeEventListener('keydown', k)
}, [intro, landing, heroOut])

  const enter = () => {
    if (leaving) return
    setLeaving(true)
    setTab('map')
    map.current.flyTo({ center: [88.5, 21.95], zoom: window.innerWidth >= 900 ? 8.5 : 8.2, duration: 3500, padding: pad() })
    setTimeout(() => { setIntro(false); setLeaving(false) }, 800)
  }
const beginStory = () => {
  if (heroOut) return
  setHeroOut(true)
  setTimeout(() => { setLanding(false); setHeroOut(false) }, 500)
}
  const fly = (h) => {
    map.current.flyTo({ center: [h.lon, h.lat], zoom: 11, duration: 2500, padding: pad() })
    if (window.innerWidth < 900) setOpen(false)
  }
  const pickTab = (t) => { setTab(t); setOpen(true) }
  const replay = () => { setSel(null); setStoryStep(0); setLanding(true); setIntro(true) }
  /* ---------- derived numbers ---------- */
  const valid = useMemo(() => pts.filter((p) => p.coh >= minCoh), [pts, minCoh])
  const avg = valid.length ? valid.reduce((s, p) => s - p.rate, 0) / valid.length : 0
  const mx = valid.length ? Math.max(...valid.map((p) => -p.rate)) : 0
  const reliable = pts.length ? (valid.length / pts.length) * 100 : 0
  const hist = useMemo(() => {
    const b = Array.from({ length: 10 }, (_, i) => ({ bin: i, n: 0 }))
    valid.forEach((p) => { b[Math.min(9, Math.max(0, Math.floor(-p.rate)))].n++ })
    return b
  }, [valid])
  const avgRel = avg + slr
  const projCm = (avgRel * (horizon - 2025)) / 10
  const severe = valid.length ? (valid.filter((p) => -p.rate + slr >= 9).length / valid.length) * 100 : 0
  const lastShift = shift.length ? shift[shift.length - 1].km : 0
  const rel = sel ? -sel.rate + slr : 0
  const risk = riskOf(rel)
/* ---------- live feeds ---------- */
useEffect(() => {
  let stop = false
  const load = async () => {
    try {
      const tz = 'Asia%2FKolkata'
      const [m, w] = await Promise.all([
        fetch(`https://marine-api.open-meteo.com/v1/marine?latitude=${LIVE_PT.lat}&longitude=${LIVE_PT.lon}&current=wave_height,sea_surface_temperature,sea_level_height_msl&hourly=sea_level_height_msl&forecast_days=2&timezone=${tz}`).then((r) => r.json()),
        fetch(`https://api.open-meteo.com/v1/forecast?latitude=${LIVE_PT.lat}&longitude=${LIVE_PT.lon}&current=wind_speed_10m,precipitation&timezone=${tz}`).then((r) => r.json()),
      ])
      if (stop) return
      const h = m.hourly || { time: [], sea_level_height_msl: [] }
      const sea = h.time
        .map((t, i) => ({ label: `${t.slice(8, 10)}/${t.slice(5, 7)} ${t.slice(11, 13)}h`, v: h.sea_level_height_msl[i] }))
        .filter((d) => d.v != null)
      setLive({ marine: m.current || null, wx: w.current || null, sea, err: !m.current })
    } catch (e) { if (!stop) setLive((s) => ({ ...s, err: true })) }
  }
  load()
  const id = setInterval(load, 10 * 60 * 1000)
  return () => { stop = true; clearInterval(id) }
}, [])

useEffect(() => {
  let stop = false
  const since = new Date(Date.now() - 60 * 864e5).toISOString().slice(0, 19) + 'Z'
  const url = `https://api.daac.asf.alaska.edu/services/search/param?dataset=NISAR&processingLevel=GCOV&intersectsWith=${encodeURIComponent(AOI_WKT)}&start=${since}&maxResults=100&output=geojson`
  const get = (u) => fetch(u)
    .then((r) => (r.ok ? r.json() : Promise.reject(r.status)))
    .then((g) => (g && g.features ? g : Promise.reject('no features')))
  get(url).catch(() => get('/data/live/nisar.geojson'))
    .then((g) => { if (!stop) setNisar({ status: 'ok', geo: g }) })
    .catch(() => { if (!stop) setNisar({ status: 'offline', geo: null }) })
  return () => { stop = true }
}, [])

const nisarItems = useMemo(() => (nisar.geo ? nisar.geo.features : [])
  .map((f) => ({ f, t: f.properties && (f.properties.startTime || f.properties.start_time) }))
  .filter((x) => x.t)
  .sort((a, b) => new Date(b.t) - new Date(a.t)), [nisar])
const lastPassDays = nisarItems.length ? Math.max(0, Math.floor((Date.now() - new Date(nisarItems[0].t)) / 864e5)) : null

useEffect(() => {
  if (!ready) return
  map.current.getSource('nisar').setData({ type: 'FeatureCollection', features: nisarItems.slice(0, 12).map((x) => x.f) })
}, [nisarItems, ready])
useEffect(() => {
  if (!ready) return
  const m = map.current
  if (m.getLayer('liveimg')) m.removeLayer('liveimg')
  if (m.getSource('liveimg')) m.removeSource('liveimg')
  const firstSym = m.getStyle().layers.find((l) => l.type === 'symbol')
  m.addSource('liveimg', { type: 'raster', tiles: [gibsUrl(imgDate)], tileSize: 256, maxzoom: 9, attribution: 'Imagery: NASA GIBS' })
  m.addLayer({ id: 'liveimg', type: 'raster', source: 'liveimg',
    layout: { visibility: liveImg && tab === 'live' && !intro ? 'visible' : 'none' } }, firstSym && firstSym.id)
}, [ready, imgDate])
useEffect(() => { vis('liveimg', liveImg && tab === 'live' && !intro) }, [liveImg, tab, intro, ready])
useEffect(() => { vis('nisar-line', showNisar && tab === 'live' && !intro) }, [showNisar, tab, intro, ready])
  const axis = { fill: '#8e9a93', fontSize: 10 }
  const ti = TABS.findIndex((t) => t[0] === tab)

  /* ---------- story geometry: map the 1000x760 route space onto the screen ---------- */
  const mobile = vp.w < 900
  const sc = mobile ? Math.min(vp.w / 1000, vp.h / 760) : Math.max(vp.w / 1000, vp.h / 760)
  const ox = (vp.w - 1000 * sc) / 2
  const oy = mobile ? 0 : (vp.h - 760 * sc) / 2
  const S = STORY[storyStep]
  const StoryArt = S.art
  const dotPx = { x: S.dot[0] * sc + ox, y: S.dot[1] * sc + oy }
  const CARD_W = 380
  const near = CARD_NEAR_DOT && !mobile
  const flip = dotPx.x + 44 + CARD_W > vp.w - 20
  const cardLeft = flip ? dotPx.x - 44 - CARD_W : dotPx.x + 44
  const cardTop = Math.min(Math.max(dotPx.y - 80, 84), Math.max(84, vp.h - (vp.h < 760 ? 400 : 520)))  
  const cardAy = Math.min(Math.max(dotPx.y - cardTop, 20), 380)

  return (
    <>
      <div ref={el} className="map" />

            {/* ---------- story: stylised delta map, route runs left to right ---------- */}
      {intro && (
        <div className={`story ${leaving ? 'leaving' : ''} ${landing ? 'landing' : ''}`}>
          <div className="story-topline">
            <span>DELTAPULSE</span>
            <span className="mid">SUNDARBANS · INDIA / BANGLADESH</span>
            <button onClick={enter}>{landing ? 'Skip to map →' : 'Skip story →'}</button>
          </div>

          <div className="story-map">
            <svg viewBox="0 0 1000 760" preserveAspectRatio={mobile ? 'xMidYMin meet' : 'xMidYMid slice'}>
              <path className="delta-land" d="M-40 110 Q100 40 210 145 T420 150 T650 120 T1040 170 L1040 330 Q900 290 820 360 T600 350 T400 420 T170 360 T-40 430Z" />
              <path className="delta-land" d="M-30 520 Q130 430 240 520 T470 535 T690 490 T1030 560 L1030 800 L-30 800Z" />
              <g className="river-lines">
                <path d="M-20 210 C180 110 190 310 370 230 S560 110 650 260 820 360 1020 220" />
                <path d="M80 0 C190 180 320 120 350 300 S520 470 610 350 780 180 940 320" />
                <path d="M-20 610 C150 450 220 690 400 590 S650 450 760 610 900 690 1040 570" />
                <path d="M500 -20 C420 150 560 220 500 360 S420 570 540 780" />
              </g>
              <g className="journey">
                {SEGS.map((d, i) => (
                  <g key={i}>
                    <path className="route-base" d={d} />
                    <path className={`route-done ${storyStep > i ? 'on' : ''}`} pathLength="1" d={d} />
                  </g>
                ))}
                {STORY.map((s, i) => (
                  <g key={i} className={`route-dot ${storyStep === i ? 'active' : ''} ${storyStep > i ? 'past' : ''}`} onClick={() => setStoryStep(i)}>
                    <circle className="hit" cx={s.dot[0]} cy={s.dot[1]} r="34" />
                    <circle className="pulse" cx={s.dot[0]} cy={s.dot[1]} r="20" />
                    <circle className="ring" cx={s.dot[0]} cy={s.dot[1]} r="20" />
                    <text className="num" x={s.dot[0]} y={s.dot[1] + 5}>{i + 1}</text>
                    <text className="dot-label" x={s.dot[0]} y={s.dot[1] + 46}>{s.label}</text>
                  </g>
                ))}
              </g>
            </svg>
          </div>

          {landing ? (
            <div className={`hero ${heroOut ? 'out' : ''}`}>
              <div className="pulse-rings"><i /><i /><i /></div>
              <span className="hero-kicker">SUNDARBANS · INDIA / BANGLADESH</span>
              <h1 className="hero-title"><img src="/icon-192.png" alt="" />Delta<em>Pulse</em></h1>
              <p className="hero-line">{`A radar view of how the Sundarbans is sinking and its shoreline is shifting.`}</p>
              <button className="cta" onClick={beginStory}>Begin the journey →</button>
              <span className="hero-hint">or press Enter</span>
            </div>
          ) : (
            <article key={storyStep} className={`story-card ${near ? 'near' : 'docked'} ${flip ? 'flip' : ''}`}
              style={near ? { left: cardLeft, top: cardTop, '--ay': `${cardAy}px` } : undefined}>
              <div className="card-head"><span className="kicker">{S.eyebrow}</span><span className="count">0{storyStep + 1} / 0{STORY.length}</span></div>
              <div className="story-progress"><span style={{ width: `${((storyStep + 1) / STORY.length) * 100}%` }} /></div>
              <div className="card-art"><StoryArt /></div>
              <h1>{S.title}</h1>
              <p>{S.text}</p>
              {S.detail && <p className="story-detail">{S.detail}</p>}
              <div className="story-nav">
                <button disabled={storyStep === 0} onClick={() => setStoryStep((v) => Math.max(0, v - 1))}>← Back</button>
                <button className="next" onClick={() => (storyStep === STORY.length - 1 ? enter() : setStoryStep((v) => v + 1))}>
                  {storyStep === STORY.length - 1 ? 'Explore the map →' : 'Next stop →'}
                </button>
              </div>
            </article>
          )}
        </div>
      )}

      {/* ---------- app: floating index + glass panel ---------- */}
      {!intro && (
        <>
          <header className="topbar">
            <div className="wordmark"><img src="/icon-192.png" alt="" /><span>DeltaPulse</span></div>
            <nav className="index" aria-label="Sections">
              {TABS.map(([k, label], i) => (
                <button key={k} className={tab === k ? 'on' : ''} onClick={() => pickTab(k)}>
                  <sup>{String(i + 1).padStart(2, '0')}</sup>{label}
                </button>
              ))}
            </nav>
          </header>

          {tab === 'map' && !sel && (
            <div className="float-metric">
              <span className="mini">Average land sinking</span>
              <b>{avg.toFixed(1)}<i>mm/yr</i></b>
              <span className="sub">{severe.toFixed(0)}% of the measured area sits in the severe zone</span>
            </div>
          )}

          <aside className={`panel ${open ? 'open' : 'closed'}`}>
            <div className="p-head">
              <span className="kicker">{String(ti + 1).padStart(2, '0')} — {TABS[ti][1].toUpperCase()}</span>
              <button className="fold" onClick={() => setOpen(!open)} aria-label="Toggle panel">{open ? '–' : '+'}</button>
            </div>

            {open && (
              <div className="p-body">
                <h2 className="title">{TITLES[tab]}</h2>

                {tab === 'map' && (
                  <>
                    <div className="field">
                      <div className="f-head"><span>Shoreline year</span><em className="val">{year}</em>
                        <button className="play" onClick={() => setPlaying(!playing)}>{playing ? 'Pause' : 'Play'}</button></div>
                      <Slider min={2015} max={2025} value={year} ticks={11} onChange={(v) => { setPlaying(false); setYear(v) }} />
                    </div>
                    <div className="field">
                      <div className="f-head"><span>Minimum coherence</span><em className="val">{minCoh.toFixed(2)}</em></div>
                      <Slider min={0} max={0.9} step={0.05} value={minCoh} ticks={10} fmt={(v) => v.toFixed(2)} onChange={setMinCoh} />
                    </div>
                    <div className="switches">
                      <Switch label="Subsidence" on={showSubs} onChange={() => setShowSubs(!showSubs)} />
                      <Switch label="2015 baseline" on={showBase} onChange={() => setShowBase(!showBase)} />
                      <Switch label="Satellite imagery" on={sat} onChange={() => setSat(!sat)} />
                    </div>
                    <div className="jump">
                      <span className="mini">Jump to</span>
                      {HOTSPOTS.map((h) => <button key={h.name} onClick={() => fly(h)}>{h.name}<i>→</i></button>)}
                    </div>
                    <div>
                      <div className="legend" />
                      <div className="legend-l"><span>Sinking fast</span><span>Stable</span></div>
                    </div>
                    <p className="fine">Dashed parchment line: 2015 shoreline. Teal line: selected year. Tap a dot to inspect it.</p>
                  </>
                )}

                {tab === 'land' && (
                  <>
                    <div className="metrics">
                      <Metric big label="Average sinking" value={avg.toFixed(1)} unit="mm/yr" />
                      <Metric label="Maximum" value={mx.toFixed(1)} unit="mm/yr" />
                      <Metric label="Reliable pixels" value={reliable.toFixed(0)} unit="%" />
                    </div>
                    <div>
                      <span className="mini">Measurement points by sinking rate (mm/yr)</span>
                      <ResponsiveContainer width="100%" height={160}>
                        <BarChart data={hist}>
                          <CartesianGrid stroke="rgba(255,255,255,.06)" vertical={false} />
                          <XAxis dataKey="bin" tick={axis} axisLine={false} tickLine={false} />
                          <YAxis tick={axis} width={34} axisLine={false} tickLine={false} />
                          <Tooltip contentStyle={tip} cursor={{ fill: 'rgba(255,255,255,.04)' }} />
                          <Bar dataKey="n" fill={C.teal} radius={[2, 2, 0, 0]} />
                        </BarChart>
                      </ResponsiveContainer>
                    </div>
                    <p className="fine">Only points at or above the coherence setting ({minCoh.toFixed(2)}) are counted. Change it in the Map section.</p>
                  </>
                )}

                {tab === 'coast' && (
                  <>
                    <div className="metrics">
                      <Metric big label="Shift since 2015" value={lastShift.toFixed(1)} unit="km" />
                      <Metric label="Average pace" value={(lastShift / 10).toFixed(2)} unit="km/yr" />
                    </div>
                    <div>
                      <span className="mini">Average shoreline position change since 2015 (km)</span>
                      <ResponsiveContainer width="100%" height={160}>
                        <LineChart data={shift}>
                          <CartesianGrid stroke="rgba(255,255,255,.06)" vertical={false} />
                          <XAxis dataKey="year" tick={axis} axisLine={false} tickLine={false} />
                          <YAxis tick={axis} width={34} axisLine={false} tickLine={false} />
                          <Tooltip contentStyle={tip} />
                          <Line type="monotone" dataKey="km" stroke={C.blue} strokeWidth={1.5} dot={false} />
                        </LineChart>
                      </ResponsiveContainer>
                    </div>
                    <p className="fine">Use the year slider and Play in the Map section to watch the shoreline move.</p>
                  </>
                )}
{tab === 'live' && (
  <>
    <div className="livebar">
      <i className={live.err ? 'dot off' : 'dot'} />
      <span>{live.err ? 'Sea & weather feed unavailable' : live.marine ? `Live · model time ${live.marine.time.slice(11, 16)} IST` : 'Connecting…'}</span>
    </div>
    <div className="metrics">
      <Metric big label="Sea level now (model)" value={signed(live.marine && live.marine.sea_level_height_msl)} unit="m vs mean" />
      <Metric label="Waves" value={fmt1(live.marine && live.marine.wave_height)} unit="m" />
      <Metric label="Sea temperature" value={fmt1(live.marine && live.marine.sea_surface_temperature)} unit="°C" />
      <Metric label="Wind" value={fmt1(live.wx && live.wx.wind_speed_10m, 0)} unit="km/h" />
      <Metric label="Rain now" value={fmt1(live.wx && live.wx.precipitation)} unit="mm" />
    </div>
    <div>
      <span className="mini">Sea level, next 48 h · model, off Sagar Island</span>
      <ResponsiveContainer width="100%" height={130}>
        <LineChart data={live.sea}>
          <CartesianGrid stroke="rgba(255,255,255,.06)" vertical={false} />
          <XAxis dataKey="label" tick={axis} interval={11} axisLine={false} tickLine={false} />
          <YAxis tick={axis} width={34} axisLine={false} tickLine={false} />
          <Tooltip contentStyle={tip} />
          <Line type="monotone" dataKey="v" stroke={C.blue} strokeWidth={1.5} dot={false} />
        </LineChart>
      </ResponsiveContainer>
    </div>
    <div className="switches">
      <Switch label="Daily satellite image" on={liveImg} onChange={() => setLiveImg(!liveImg)} />
      {liveImg && (
        <div className="stepper">
          <button disabled={imgDaysAgo >= 7} onClick={() => setImgDaysAgo((d) => Math.min(7, d + 1))}>‹ Earlier</button>
          <span>{imgDate}</span>
          <button disabled={imgDaysAgo <= 1} onClick={() => setImgDaysAgo((d) => Math.max(1, d - 1))}>Later ›</button>
        </div>
      )}
      <Switch label="NISAR coverage outlines" on={showNisar} onChange={() => setShowNisar(!showNisar)} />
      <Switch label="Subsidence points" on={showSubs} onChange={() => setShowSubs(!showSubs)} />
      <Switch label="2015 baseline shoreline" on={showBase} onChange={() => setShowBase(!showBase)} />
    </div>
    <div className="metrics">
      <Metric label="Latest NISAR pass" value={lastPassDays == null ? '–' : lastPassDays} unit="days ago" />
      <Metric label="Products, 60 days" value={nisarItems.length} unit="GCOV" />
    </div>
    <p className="fine">
      {nisar.status === 'loading' ? 'Checking the ASF archive…'
        : nisar.status === 'offline' ? 'NISAR feed not connected. Run scripts/nisar_live.py to feed it.'
        : 'NISAR products over the Sundarbans from ASF DAAC. New passes appear as ASF finishes processing them.'}
    </p>
    <p className="fine">Daily image: NASA GIBS (NOAA-20 VIIRS, about 250 m; clouds block the view). Sea and weather: model estimates from Open-Meteo.com, not a tide gauge.</p>
  </>
)}
                {tab === 'risk' && (
                  <>
                    <p className="note">Relative sea-level rise is land sinking plus sea-level rise. Change the assumptions to see what follows.</p>
                    <div className="field">
                      <div className="f-head"><span>Sea-level rise</span><em className="val">{slr} mm/yr</em></div>
                      <Slider min={2} max={8} step={0.5} value={slr} ticks={7} fmt={(v) => `${v} mm/yr`} onChange={setSlr} />
                    </div>
                    <div className="field">
                      <div className="f-head"><span>Look ahead to</span><em className="val">{horizon}</em></div>
                      <Slider min={2030} max={2100} step={5} value={horizon} ticks={8} onChange={setHorizon} />
                    </div>
                    <div className="metrics">
                      <Metric big label={`Relative rise by ${horizon}`} value={`≈ ${projCm.toFixed(0)}`} unit="cm" />
                      <Metric label="Average rate" value={avgRel.toFixed(1)} unit="mm/yr" />
                      <Metric label="Severe zone (≥ 9)" value={severe.toFixed(0)} unit="%" />
                    </div>
                    <p className="fine">Projection assumes current rates continue. It is illustrative, not a forecast.</p>
                  </>
                )}

               
                {tab === 'about' && (
                  <>
                    <p className="note"><b>Data.</b> SAR imagery processed with InSAR for ground displacement, plus yearly shoreline positions. Processing details (sensor, dates, chain) to be added by the SAR team.</p>
                    <p className="note"><b>Coherence</b> shows how reliable each radar pixel is. Mangroves and water lose coherence, so unreliable pixels can be hidden.</p>
                    <p className="note"><b>Risk classes</b> use illustrative thresholds (6 and 9 mm/yr) pending review. Projections are not forecasts.</p>
                    <p className="note"><b>Data status:</b> {DATA_IS_PLACEHOLDER ? 'preview dataset, final SAR results pending.' : 'final processed results.'}</p>
                    <p className="fine">Basemap © OpenStreetMap contributors © CARTO · Imagery © Esri · Built for the NASA Space Apps Challenge.</p>
                    <button className="textlink" onClick={replay}>Replay the story →</button>
                  </>
                )}
              </div>
            )}
          </aside>
        </>
      )}

      {/* ---------- point inspector ---------- */}
      {sel && !intro && (
        <section className="inspector">
          <button className="x" onClick={() => setSel(null)} aria-label="Close">×</button>
          <span className="kicker">POINT INSPECTOR</span>
          <small className="coord">{sel.lat.toFixed(3)}°N · {sel.lon.toFixed(3)}°E</small>
          <div className="i-big"><b>{(-sel.rate).toFixed(1)}<i>mm/yr</i></b><span>land sinking</span></div>
          <div className="i-row">
            <div><span>Coherence</span><b>{sel.coh.toFixed(2)}{sel.coh < 0.4 ? ' ⚠' : ''}</b></div>
            <div><span>Relative rise</span><b>{rel.toFixed(1)}</b></div>
            <div><span>By {horizon}</span><b>≈ {((rel * (horizon - 2025)) / 10).toFixed(0)} cm</b></div>
          </div>
          <span className={`risk ${risk.cls}`}><i />Risk · {risk.label}</span>
          <ResponsiveContainer width="100%" height={100}>
            <LineChart data={getTimeSeries(sel)}>
              <XAxis dataKey="t" type="number" domain={['dataMin', 'dataMax']} tick={axis} tickCount={5} axisLine={false} tickLine={false} />
              <YAxis tick={axis} width={30} axisLine={false} tickLine={false} />
              <Tooltip contentStyle={tip} />
              <Line type="monotone" dataKey="d" stroke={C.teal} dot={false} strokeWidth={1.5} />
            </LineChart>
          </ResponsiveContainer>
        </section>
      )}
    </>
  )
}
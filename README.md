# Valley County Fire Season Explorer

Interactive climate maps and countywide charts for Valley County, Idaho, developed for the UCross Donnelly project.

**[Open the explorer](https://simonxyw.github.io/valley-county-fire-season-explorer/)**

Compare individual years or a continuous range from **2021 to 2025** against a fixed **1991–2020 reference**. Historical annual charts include **1991–2025**. Every seasonal comparison covers **June 1 through October 30**, inclusive.

## Indicators

| Indicator | Seasonal measure | Source |
| --- | --- | --- |
| Precipitation | Total precipitation, mm | PRISM, via Climate Engine |
| Mean temperature | Mean daily temperature, °C | PRISM, via Climate Engine |
| Maximum temperature | Mean daily maximum temperature, °C | PRISM, via Climate Engine |
| Vapor pressure deficit | Mean VPD, kPa | gridMET, via Climate Engine |
| Fire Weather Index | Mean FWI, dimensionless | CEMS, via Climate Engine |
| Drought (SPEI) | Seasonal Hargreaves SPEI and drought-area statistics | PRISM, standardized through Climate Engine |

The maximum-temperature indicator describes the seasonal average of daily maximum temperatures.

## Explore and export

- Select an indicator and one year or a range using the two timeline handles or year inputs.
- In **Map**, drag the divider to compare seasonal values with their reference or difference. SPEI displays moisture classes for one year and drought frequency for multiple years.
- Pan, zoom, and hover or click for location values. Map options control opacity, basemap, roads, place names, and color scales.
- In **Graph**, explore countywide annual trends and, where available, daily or weekly seasonal curves. The five-year moving average applies to annual graphs.
- Export the current view as **PNG**, **PDF**, or **CSV**. CSV files include numerical values and source, period, and quality metadata.
- Open **About the data** for methods, class definitions, and scientific references.

## Scope and calculation

| Setting | Value |
| --- | --- |
| Study area | Valley County, Idaho |
| Comparison years | 2021–2025 |
| Historical annual record | 1991–2025: 35 seasons per indicator |
| Seasonal window | June 1–October 30: 152 expected days |
| Reference period | 1991–2020 |
| Seasonal grids | 210: six indicators × 35 years |

Selected ranges give each annual season equal weight. Precipitation comparisons average annual seasonal totals; temperature, VPD, and FWI comparisons average annual seasonal means.

Maps retain the source grids and clip climate layers to the county boundary. Seasonal county summaries use county-intersection area weights. Daily regional series use the simplified Climate Engine query boundary, so they represent a distinct spatial aggregation.

SPEI is standardized accumulated precipitation minus Hargreaves potential evapotranspiration for the selected seasonal window. One-year views show the index and seven moisture classes. Multi-year drought frequency is the percentage of selected annual seasons with **SPEI ≤ −1** at each cell. County drought area uses area weights. Classification uses unrounded values; a multi-year mean SPEI is not reclassified.

### Known source gap

The CEMS FWI source lacks **August 8, 2024**. The 2024 seasonal mean uses **151 of 152 expected days**, with no interpolation. Daily and weekly displays retain the gap. Multi-year selections continue to weight annual seasons equally. SPEI source-day coverage has not been independently audited.

## Files and local preview

This is a static website. The published files sit at the repository root:

```text
index.html          Interface and About content
app.mjs             Maps, charts, controls, and exports
math.mjs            Climate calculations and spatial queries
export-state.mjs    Exact-view export settings
style.css           Layout and visual styles
data/               Six climate bundles, manifest, and county boundary
vendor/             Leaflet, noUiSlider, and jsPDF
```

The website runs in the browser without a build step, application server, or visitor API key. Climate data are included in this repository; basemaps and reference layers load from external map services.

To preview locally, run this from the repository folder:

```sh
python3 -m http.server 8080
```

Then open [http://localhost:8080](http://localhost:8080). Serve the files over HTTP so the browser can load modules and data.

## GitHub Pages

In **Settings → Pages**, use **Deploy from a branch**, select **main** and **/ (root)**, and save. Keep `index.html`, `data/`, and `vendor/` at the same level. Asset paths are relative to support the GitHub project URL.

## ArcGIS StoryMaps

Add an **Embed** block using:

```html
<iframe
  src="https://simonxyw.github.io/valley-county-fire-season-explorer/?metric=precip&amp;from=2025&amp;to=2025&amp;panel=map"
  title="Valley County Fire Season Explorer"
  width="100%"
  height="900"
  frameborder="0"
  allowfullscreen>
</iframe>
```

Use the **Large** display size. The embed's options control the separate “open live content in a new tab” icon.

StoryMaps restricts downloads inside its iframe. Add a native StoryMap button labeled **Open full explorer for downloads**, pointing to the [full explorer](https://simonxyw.github.io/valley-county-fire-season-explorer/). Readers can download there. Embedded Export controls explain the route and provide an exact-view download URL preserving the selected indicator, years, and presentation settings.

Supported basic URL parameters:

```text
metric=precip|tmean|tmax|vpd|fwi|speih
from=2021
to=2025
panel=map|graph
```

## Updating the data

This repository contains the prepared website and data bundles. The upstream Climate Engine acquisition and validation workflow is maintained separately.

To add a year, obtain and validate the new seasonal grids and available daily series, regenerate the bundles and manifest, update year limits, chart labels, and export validation, and verify maps, charts, and downloads before publishing. Preserve the **1991–2020 reference**, seasonal window, and documented source-gap handling. The current release does not include 2026 data.

## Credits

Project author: **Simon Wu**.

Climate data: **Climate Engine, PRISM, gridMET, and CEMS**. Basemaps and reference layers: **Esri and its data providers**. Vendored **Leaflet**, **noUiSlider**, and **jsPDF** retain their distribution license headers.

Scientific and classification references are listed in the explorer's **About the data** panel.

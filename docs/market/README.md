# Public weekly Brent observations

Data source: U.S. Energy Information Administration via FRED, series DCOILBRENTEU.
https://fred.stlouisfed.org/series/DCOILBRENTEU

`oil.json` contains arithmetic weekly averages of available daily spot observations from completed calendar weeks, minimum three observations. The date denotes Monday; `lastObservation` is the last actual source observation used in the week. Missing days are not interpolated. This is not a futures series. Data may be revised by the source.

`node scripts/update-oil.mjs` refreshes the public data. The Friday GitHub workflow publishes the exact updated source commit. Failed downloads do not replace the last saved JSON. No supplier quotes or licensed raw-material reviews belong in this directory.

// Preserve links to the calculator's previous root-page location.
if (['#calculator', '#reference-data', '#offers'].includes(window.location.hash)) {
  window.location.replace(`calculator.html${window.location.hash}`);
}

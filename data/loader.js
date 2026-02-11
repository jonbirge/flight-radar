// Synchronous JSON loader for data files.
// Loaded via <script> tag before shared modules.

'use strict';

function loadJSON(path) {
  var xhr = new XMLHttpRequest();
  xhr.open('GET', path, false);
  xhr.send();
  if (xhr.status !== 200) {
    console.warn('[DataLoader] Failed to load ' + path + ' (HTTP ' + xhr.status + ')');
    return undefined;
  }
  return JSON.parse(xhr.responseText);
}

var AIRPORT_DB = loadJSON('../data/airports.json');
var AIRSPACE_DB = loadJSON('../data/airspace.json');

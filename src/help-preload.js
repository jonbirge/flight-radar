// help-preload.js — context bridge for the help window
'use strict';

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('helpAPI', {
  getSettings: () => ipcRenderer.invoke('get-settings'),
  onSettingsChanged: (cb) => ipcRenderer.on('settings-changed', cb),
});

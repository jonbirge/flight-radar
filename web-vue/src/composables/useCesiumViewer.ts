/**
 * Cesium Viewer composable.
 * Owns the Viewer instance (shallowRef), container mount/unmount, scene config,
 * and theme application to Cesium (tile layers, globe styling, CSS variables).
 *
 * Ported from shared/radar-core.js (viewer init, makeMapTiles, applyTheme, styleMapLayer).
 */

import { shallowRef, watch, onUnmounted, type Ref } from 'vue';
import {
  Viewer,
  ImageryLayer,
  UrlTemplateImageryProvider,
  OpenStreetMapImageryProvider,
  WebMapTileServiceImageryProvider,
  Credit,
  Color,
  Cartesian3,
  HeadingPitchRange,
  Matrix4,
  Math as CesiumMath,
  WebMercatorProjection,
  Ion,
  SceneMode,
} from 'cesium';
import { useSettingsStore } from '@/stores/settings';
import { hexToRgb, withAlpha } from '@/core/colors';

// ============================================================
// Types
// ============================================================

type ImageryProvider =
  | UrlTemplateImageryProvider
  | OpenStreetMapImageryProvider
  | WebMapTileServiceImageryProvider;

export interface CesiumViewerReturn {
  /** The Cesium Viewer instance (shallowRef — never deeply reactive) */
  viewer: Ref<Viewer | null>;
  /** Apply theme (tile layers, globe styling, CSS vars) — call on theme or setting change */
  applyTheme: () => Promise<void>;
  /** Swap the map tile layer */
  applyMapLayer: (layerId: string) => Promise<void>;
  /** Destroy the viewer and clean up */
  destroy: () => void;
}

// ============================================================
// Constants
// ============================================================

const VFRMAP_DATE = '20251225';

/** Layers that need a CartoDB base underneath (limited zoom) */
const OVERLAY_LAYERS = new Set(['vfrHybrid', 'vfrIfrLow', 'vfrIfrHigh']);

/** Layers that are already theme-matched — skip brightness/saturation adjustment in dark mode */
const NO_STYLE_LAYERS = new Set(['carto', 'noLabels', 'esriGray']);

/** Layers that should never have muted colors */
const NO_MUTE_LAYERS = new Set(['vfrIfrLow', 'vfrIfrHigh', 'topo']);

// ============================================================
// Tile Providers
// ============================================================

function makeDarkTiles(): UrlTemplateImageryProvider {
  return new UrlTemplateImageryProvider({
    url: 'https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}.png',
    subdomains: ['a', 'b', 'c', 'd'],
    credit: new Credit('CartoDB'),
    minimumLevel: 0,
    maximumLevel: 18,
  });
}

function makeLightTiles(): UrlTemplateImageryProvider {
  return new UrlTemplateImageryProvider({
    url: 'https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}.png',
    subdomains: ['a', 'b', 'c', 'd'],
    credit: new Credit('CartoDB'),
    minimumLevel: 0,
    maximumLevel: 18,
  });
}

function makeDarkNoLabelsTiles(): UrlTemplateImageryProvider {
  return new UrlTemplateImageryProvider({
    url: 'https://{s}.basemaps.cartocdn.com/dark_nolabels/{z}/{x}/{y}.png',
    subdomains: ['a', 'b', 'c', 'd'],
    credit: new Credit('CartoDB'),
    minimumLevel: 0,
    maximumLevel: 18,
  });
}

function makeLightNoLabelsTiles(): UrlTemplateImageryProvider {
  return new UrlTemplateImageryProvider({
    url: 'https://{s}.basemaps.cartocdn.com/light_nolabels/{z}/{x}/{y}.png',
    subdomains: ['a', 'b', 'c', 'd'],
    credit: new Credit('CartoDB'),
    minimumLevel: 0,
    maximumLevel: 18,
  });
}

function makeEsriGrayTiles(theme: 'dark' | 'light'): UrlTemplateImageryProvider {
  const variant = theme === 'dark' ? 'World_Dark_Gray_Base' : 'World_Light_Gray_Base';
  return new UrlTemplateImageryProvider({
    url: `https://services.arcgisonline.com/ArcGIS/rest/services/Canvas/${variant}/MapServer/tile/{z}/{y}/{x}`,
    credit: new Credit('Esri'),
    minimumLevel: 0,
    maximumLevel: 16,
  });
}

function makeSatelliteTiles(): UrlTemplateImageryProvider {
  return new UrlTemplateImageryProvider({
    url: 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
    credit: new Credit('Esri, Maxar, Earthstar Geographics'),
    minimumLevel: 0,
    maximumLevel: 19,
  });
}

function makeOsmTiles(): OpenStreetMapImageryProvider {
  return new OpenStreetMapImageryProvider({
    url: 'https://tile.openstreetmap.org/',
    credit: new Credit('OpenStreetMap contributors'),
  });
}

function makeTopoTiles(): UrlTemplateImageryProvider {
  return new UrlTemplateImageryProvider({
    url: 'https://{s}.tile.opentopomap.org/{z}/{x}/{y}.png',
    subdomains: ['a', 'b', 'c'],
    credit: new Credit('OpenTopoMap, OpenStreetMap contributors'),
    minimumLevel: 0,
    maximumLevel: 17,
  });
}

function makeNightTiles(): WebMapTileServiceImageryProvider {
  return new WebMapTileServiceImageryProvider({
    url: 'https://gibs.earthdata.nasa.gov/wmts/epsg3857/best/wmts.cgi',
    layer: 'VIIRS_Black_Marble',
    style: 'default',
    format: 'image/png',
    tileMatrixSetID: 'GoogleMapsCompatible_Level8',
    maximumLevel: 8,
    credit: new Credit('NASA EOSDIS GIBS'),
  });
}

function makeVfrMapTiles(chartType: string, maxZoom: number, proxyUrl?: string): UrlTemplateImageryProvider {
  const url = proxyUrl
    ? `${proxyUrl}?date=${VFRMAP_DATE}&chart=${chartType}&z={z}&y={reverseY}&x={x}`
    : `https://vfrmap.com/${VFRMAP_DATE}/tiles/${chartType}/{z}/{reverseY}/{x}.jpg`;
  return new UrlTemplateImageryProvider({
    url,
    credit: new Credit('VFRMap.com'),
    minimumLevel: 1,
    maximumLevel: maxZoom,
  });
}

function makeBaseTiles(theme: 'dark' | 'light'): UrlTemplateImageryProvider {
  return theme === 'dark' ? makeDarkTiles() : makeLightTiles();
}

function makeMapTiles(layerId: string, theme: 'dark' | 'light', proxyUrl?: string): ImageryProvider {
  switch (layerId) {
    case 'noLabels':   return theme === 'dark' ? makeDarkNoLabelsTiles() : makeLightNoLabelsTiles();
    case 'esriGray':   return makeEsriGrayTiles(theme);
    case 'satellite':  return makeSatelliteTiles();
    case 'osm':        return makeOsmTiles();
    case 'topo':       return makeTopoTiles();
    case 'night':      return makeNightTiles();
    case 'vfrHybrid':  return makeVfrMapTiles('vfrc', 12, proxyUrl);
    case 'vfrIfrLow':  return makeVfrMapTiles('ifrlc', 11, proxyUrl);
    case 'vfrIfrHigh': return makeVfrMapTiles('ehc', 10, proxyUrl);
    default:           return theme === 'dark' ? makeDarkTiles() : makeLightTiles();
  }
}

// ============================================================
// Map Layer Styling
// ============================================================

function styleMapLayer(
  layer: ImageryLayer,
  layerId: string,
  theme: 'dark' | 'light',
  muteMapColors: boolean,
): void {
  const isDark = theme === 'dark';
  if (isDark) {
    if (NO_STYLE_LAYERS.has(layerId)) return;
    if (layerId === 'night') {
      layer.brightness = 0.7;
      return;
    }
    if (NO_MUTE_LAYERS.has(layerId)) {
      if (OVERLAY_LAYERS.has(layerId)) layer.alpha = 0.8;
      return;
    }
    layer.brightness = 0.6;
    layer.saturation = 0.4;
    if (OVERLAY_LAYERS.has(layerId)) layer.alpha = 0.8;
  } else {
    if (!muteMapColors) return;
    if (NO_STYLE_LAYERS.has(layerId) || NO_MUTE_LAYERS.has(layerId)) return;
    layer.brightness = 1.5;
    layer.saturation = 0.3;
  }
}

// ============================================================
// CSS Theme Variables
// ============================================================

function applyCssThemeVariables(
  theme: 'dark' | 'light',
  darkColor: string,
  lightColor: string,
  phosphor: string,
  phosphorBright: string,
  phosphorDim: string,
): void {
  const root = document.documentElement;
  const isDark = theme === 'dark';

  document.body.classList.toggle('theme-light', !isDark);

  if (isDark) {
    const [r, g, b] = hexToRgb(darkColor);
    const tint = 0.07;
    const scR = Math.round(20 + r * tint);
    const scG = Math.round(20 + g * tint);
    const scB = Math.round(20 + b * tint);
    const shR = Math.round(36 + r * tint);
    const shG = Math.round(36 + g * tint);
    const shB = Math.round(36 + b * tint);
    root.style.setProperty('--md-primary', phosphor);
    root.style.setProperty('--md-on-primary', '#ffffff');
    root.style.setProperty('--md-primary-container', withAlpha(darkColor, 0.15));
    root.style.setProperty('--md-on-primary-container', phosphor);
    root.style.setProperty('--md-surface', '#121212');
    root.style.setProperty('--md-surface-container', `rgba(${scR}, ${scG}, ${scB}, 0.78)`);
    root.style.setProperty('--md-surface-container-solid', `rgb(${scR}, ${scG}, ${scB})`);
    root.style.setProperty('--md-surface-container-highest', `rgba(${shR}, ${shG}, ${shB}, 0.28)`);
    root.style.setProperty('--md-on-surface', phosphorBright);
    root.style.setProperty('--md-on-surface-variant', phosphorDim);
    root.style.setProperty('--md-on-surface-disabled', withAlpha(darkColor, 0.2));
    root.style.setProperty('--md-outline', withAlpha(darkColor, 0.3));
    root.style.setProperty('--md-outline-variant', withAlpha(darkColor, 0.12));
  } else {
    const [lr, lg, lb] = hexToRgb(lightColor);
    const lum = (0.299 * lr + 0.587 * lg + 0.114 * lb) / 255;
    root.style.setProperty('--md-primary', phosphor);
    root.style.setProperty('--md-on-primary', lum > 0.5 ? '#000000' : '#ffffff');
    root.style.setProperty('--md-primary-container', withAlpha(lightColor, 0.18));
    root.style.setProperty('--md-on-primary-container', phosphor);
    root.style.setProperty('--md-surface', '#f7f7f7');
    root.style.setProperty('--md-surface-container', 'rgba(240, 240, 240, 0.78)');
    root.style.setProperty('--md-surface-container-solid', 'rgb(240, 240, 240)');
    root.style.setProperty('--md-surface-container-highest', withAlpha(lightColor, 0.08));
    root.style.setProperty('--md-on-surface', phosphorBright);
    root.style.setProperty('--md-on-surface-variant', phosphorDim);
    root.style.setProperty('--md-on-surface-disabled', withAlpha(lightColor, 0.15));
    root.style.setProperty('--md-outline', withAlpha(lightColor, 0.2));
    root.style.setProperty('--md-outline-variant', withAlpha(lightColor, 0.1));
  }
}

// ============================================================
// Composable
// ============================================================

/**
 * Initialize and manage the Cesium Viewer.
 *
 * @param containerId - DOM element ID for the Cesium container
 * @returns viewer ref, theme/map actions, and destroy function
 */
export function useCesiumViewer(containerId: string): CesiumViewerReturn {
  const viewerRef = shallowRef<Viewer | null>(null);
  const settings = useSettingsStore();

  // ---- Viewer initialization ----

  function init(): void {
    // No Ion token needed — we use CartoDB tiles
    Ion.defaultAccessToken = 'not-used';

    const theme = settings.resolvedTheme;
    const initialTiles = theme === 'dark' ? makeDarkTiles() : makeLightTiles();

    const v = new Viewer(containerId, {
      baseLayer: new ImageryLayer(initialTiles),
      baseLayerPicker: false,
      geocoder: false,
      homeButton: false,
      sceneModePicker: false,
      selectionIndicator: false,
      infoBox: false,
      timeline: false,
      animation: false,
      navigationHelpButton: false,
      fullscreenButton: false,
      vrButton: false,
      creditContainer: document.createElement('div'),
      scene3DOnly: false,
      sceneMode: SceneMode.SCENE3D,
      mapProjection: new WebMercatorProjection(),
      orderIndependentTranslucency: false,
      msaaSamples: 4,
      contextOptions: { webgl: { antialias: true } },
    });

    // FXAA post-process anti-aliasing
    v.scene.postProcessStages.fxaa.enabled = true;

    // Dark background color for globe/space
    const bgColor = theme === 'dark' ? '#121212' : '#f7f7f7';
    v.scene.backgroundColor = Color.fromCssColorString(bgColor);
    v.scene.globe.baseColor = Color.fromCssColorString(bgColor);
    v.scene.globe.showGroundAtmosphere = false;
    v.scene.globe.enableLighting = false;
    if (v.scene.skyAtmosphere) v.scene.skyAtmosphere.show = false;
    v.scene.fog.enabled = false;

    // Initial view: look at saved view or default
    const sv = settings.settings.savedView;
    v.camera.lookAt(
      Cartesian3.fromDegrees(sv.lon, sv.lat, 0),
      new HeadingPitchRange(sv.heading, sv.pitch, sv.height),
    );
    // Unlock camera from the lookAt target
    v.camera.lookAtTransform(Matrix4.IDENTITY);

    // Camera change sensitivity
    v.camera.percentageChanged = 0.01;

    viewerRef.value = v;
  }

  // ---- Theme application ----

  async function applyTheme(): Promise<void> {
    const v = viewerRef.value;
    if (!v) return;

    const theme = settings.resolvedTheme;
    const mapLayer = settings.settings.mapLayer;
    const muteMapColors = settings.settings.muteMapColors;

    // Swap tile layers
    const layers = v.imageryLayers;
    layers.removeAll();

    const provider = makeMapTiles(mapLayer, theme);
    if (OVERLAY_LAYERS.has(mapLayer)) {
      layers.addImageryProvider(makeBaseTiles(theme));
    }
    const mapImageryLayer = layers.addImageryProvider(provider);
    styleMapLayer(mapImageryLayer, mapLayer, theme, muteMapColors);

    // Globe & scene background
    const bgColor = theme === 'dark' ? '#121212' : '#f7f7f7';
    v.scene.backgroundColor = Color.fromCssColorString(bgColor);
    v.scene.globe.baseColor = Color.fromCssColorString(bgColor);

    // CSS variables
    applyCssThemeVariables(
      theme,
      settings.settings.darkColor,
      settings.settings.lightColor,
      settings.phosphor,
      settings.phosphorBright,
      settings.phosphorDim,
    );
  }

  async function applyMapLayer(layerId: string): Promise<void> {
    const v = viewerRef.value;
    if (!v) return;

    const theme = settings.resolvedTheme;
    const muteMapColors = settings.settings.muteMapColors;

    const layers = v.imageryLayers;
    layers.removeAll();

    const provider = makeMapTiles(layerId, theme);
    if (OVERLAY_LAYERS.has(layerId)) {
      layers.addImageryProvider(makeBaseTiles(theme));
    }
    const mapImageryLayer = layers.addImageryProvider(provider);
    styleMapLayer(mapImageryLayer, layerId, theme, muteMapColors);
  }

  // ---- Destroy ----

  function destroy(): void {
    const v = viewerRef.value;
    if (v && !v.isDestroyed()) {
      v.destroy();
    }
    viewerRef.value = null;
  }

  // ---- Lifecycle ----

  init();

  // Watch for theme changes and re-apply
  const stopThemeWatch = watch(
    () => settings.resolvedTheme,
    () => applyTheme(),
  );

  // Watch for map layer changes
  const stopMapWatch = watch(
    () => settings.settings.mapLayer,
    (newLayer) => applyMapLayer(newLayer),
  );

  // Watch for mute map colors changes
  const stopMuteWatch = watch(
    () => settings.settings.muteMapColors,
    () => applyTheme(),
  );

  // Watch for dark/light color changes
  const stopColorWatch = watch(
    [() => settings.settings.darkColor, () => settings.settings.lightColor],
    () => applyTheme(),
  );

  onUnmounted(() => {
    stopThemeWatch();
    stopMapWatch();
    stopMuteWatch();
    stopColorWatch();
    destroy();
  });

  return {
    viewer: viewerRef,
    applyTheme,
    applyMapLayer,
    destroy,
  };
}

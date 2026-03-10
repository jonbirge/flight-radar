import { createApp } from 'vue';
import { createPinia } from 'pinia';
import App from './App.vue';
import 'cesium/Build/Cesium/Widgets/widgets.css';
import './styles/main.css';

const app = createApp(App);
app.use(createPinia());
app.mount('#app');

import { mount } from 'svelte';
import './app.css';
import App from './ui/App.svelte';

const target = document.getElementById('app');
if (!target) throw new Error('index.html is missing #app; nothing to mount into');

mount(App, { target });

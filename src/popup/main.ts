import { mount } from 'svelte'
import PopupApp from './PopupApp.svelte'
import './popup.css'

const app = mount(PopupApp, {
  target: document.getElementById('app')!,
})

export default app


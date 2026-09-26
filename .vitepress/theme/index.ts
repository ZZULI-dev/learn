import type { Theme } from 'vitepress'
import { defineAsyncComponent } from 'vue'
import DefaultTheme from 'vitepress/theme'
import Layout from './Layout.vue'
import ComputerScienceRoadmap from './ComputerScienceRoadmap.vue'
import FrontendRoadmap from './FrontendRoadmap.vue'
import LumNote from './LumNote.vue'
import './style.css'
import './roadmap.css'

export default {
  extends: DefaultTheme,
  Layout,
  enhanceApp(context) {
    context.app.component('ComputerScienceRoadmap', ComputerScienceRoadmap)
    context.app.component('FrontendRoadmap', FrontendRoadmap)
    context.app.component(
      'RoadmapEditor',
      defineAsyncComponent(() => import('./RoadmapEditor.vue')),
    )
    context.app.component('LumNote', LumNote)
  }
} satisfies Theme

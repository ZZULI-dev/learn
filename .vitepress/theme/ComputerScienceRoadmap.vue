<script setup lang="ts">
import computerScienceRoadmapData from '../../src/roadmaps/computer-science.json'
import RoadmapTree from './RoadmapTree.vue'
import type { RoadmapGraph } from './roadmaps/types'

const computerScienceRoadmap = computerScienceRoadmapData as RoadmapGraph
</script>

<template>
  <RoadmapTree :graph="computerScienceRoadmap" />
</template>

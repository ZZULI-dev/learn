<script setup lang="ts">
import { withBase } from 'vitepress'
import VPNav from 'vitepress/dist/client/theme-default/components/VPNav.vue'
</script>

<template>
  <div class="zz-home">
    <VPNav />
    <main>
      <section class="zz-hero" aria-labelledby="home-title">
        <div class="zz-hero-copy">
          <h1 id="home-title">从 0 到 1 的 <br /> CS 学习指南</h1>
          <span class="zz-home-status">施工中 · 9.4 开始</span>
          <p class="zz-hero-summary">一份面向学生的开发学习路线图：明确方向，打好基础，学好开发如此简单。-- The Gift for beginners</p>
          <div class="zz-hero-actions">
            <a class="zz-primary-action" :href="withBase('/getting-started/introduction')">开始探索</a>
            <a
              class="zz-github-action"
              href="https://github.com/zzuli-dev/learn"
              target="_blank"
              rel="noreferrer"
            >
              <span class="vpi-social-github" style="--icon: url('https://api.iconify.design/simple-icons/github.svg');"></span>
              GitHub
            </a>
          </div>
        </div>
        <figure class="zz-hero-figure">
          <img :src="withBase('/lum/lum-standing-small.png')" alt="Lum 拿着学习路线图与笔记本，准备开始探索" width="480" height="720">
        </figure>
      </section>
    </main>
  </div>
</template>

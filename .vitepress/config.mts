import { defineConfig } from 'vitepress'
import { writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import type { Plugin } from 'vite'
import { roadmapDefinitionById } from './roadmap-definitions.mjs'
import { isRoadmapGraphData } from './roadmap-schema.mjs'

const roadmapDirectory = resolve(process.cwd(), 'src/roadmaps')

function isPersistableRoadmap(value: unknown): value is { id: string } {
  if (!isRoadmapGraphData(value)) return false
  const id = (value as { id: string }).id
  return Boolean(roadmapDefinitionById.get(id))
}

function roadmapEditorPlugin(): Plugin {
  return {
    name: 'zzuli-roadmap-editor',
    configureServer(server) {
      server.middlewares.use('/__roadmap-editor/save', async (request, response, next) => {
        if (request.method !== 'POST') return next()

        try {
          let body = ''
          for await (const chunk of request) {
            body += String(chunk)
            if (body.length > 1_000_000) throw new Error('payload too large')
          }

          const graph: unknown = JSON.parse(body)
          if (!isPersistableRoadmap(graph)) {
            response.statusCode = 400
            response.end('Invalid roadmap graph')
            return
          }

          const definition = roadmapDefinitionById.get(graph.id)
          if (!definition) throw new Error('unknown roadmap')
          await writeFile(resolve(roadmapDirectory, definition.fileName), `${JSON.stringify(graph, null, 2)}\n`, 'utf8')
          response.statusCode = 204
          response.end()
        } catch {
          response.statusCode = 400
          response.end('Unable to save roadmap graph')
        }
      })
    },
  }
}

export default defineConfig({
  lang: 'zh-CN',
  title: 'ZZULI.dev',
  description:
    '一份面向学生的开发学习路线图：明确方向，打好基础，学好开发如此简单。-- The Gift for beginners',
  cleanUrls: true,
  lastUpdated: true,
  srcDir: 'src',
  vite: {
    plugins: [roadmapEditorPlugin()],
  },
  head: [['link', { rel: 'icon', href: '/favicon.ico' }]],
  themeConfig: {
    siteTitle: 'ZZULI<span>.dev</span>',
    nav: [
      {
        text: '<span class="vpi-square-pen zz-nav-icon" aria-hidden="true"></span><span class="visually-hidden">工具</span>',
        items: [{ text: '路线图编辑器', link: '/roadmap-editor' }],
      },
      {
        text: '<span class="vpi-sparkles zz-nav-icon" aria-hidden="true"></span><span class="visually-hidden">更多</span>',
        link: '/more',
      },
    ],
    socialLinks: [
      {
        icon: 'github',
        link: 'https://github.com/zzuli-dev/learn',
        ariaLabel: 'GitHub',
      },
    ],
    sidebar: [
      {
        text: '起步',
        items: [
          {
            text: '简介',
            link: '/getting-started/introduction',
          },
          {
            text: '如何使用',
            link: '/getting-started/how-to-use',
          },
          {
            text: '开发者基础',
            link: '/getting-started/developer-basics',
          },
          {
            text: 'Computer Science',
            link: '/getting-started/computer-science',
          },
        ],
      },
      {
        text: '🚀 开发方向',
        collapsed: true,
        items: [
          { text: 'Frontend', link: '/directions/frontend' },
          { text: 'Backend', link: '/directions/backend' },
          { text: 'Full Stack', link: '/directions/full-stack' },
          { text: 'DevOps', link: '/directions/devops' },
          { text: 'Game Developer', link: '/directions/game-developer' },
          { text: 'Embedded', link: '/directions/embedded' },
          { text: 'Cyber Security', link: '/directions/cyber-security' },
        ],
      },
      {
        text: '🤖 AI & Data',
        collapsed: true,
        items: [
          { text: 'AI Engineer', link: '/ai-data/ai-engineer' },
          { text: 'AI Agents', link: '/ai-data/ai-agents' },
          { text: 'Data Science', link: '/ai-data/data-science' },
        ],
      },
      {
        text: '💻 编程语言',
        collapsed: true,
        items: [
          { text: 'Python', link: '/languages/python' },
          { text: 'JavaScript', link: '/languages/javascript' },
          { text: 'TypeScript', link: '/languages/typescript' },
          { text: 'Java', link: '/languages/java' },
          { text: 'C', link: '/languages/c' },
          { text: 'C++', link: '/languages/cpp' },
          { text: 'Go', link: '/languages/go' },
          { text: 'Rust', link: '/languages/rust' },
        ],
      },
      {
        text: '🧰 核心技能',
        collapsed: true,
        items: [
          { text: 'Git & GitHub', link: '/core-skills/git-github' },
          { text: 'Linux', link: '/core-skills/linux' },
          { text: 'SQL', link: '/core-skills/sql' },
          { text: 'HTTP', link: '/core-skills/http' },
          { text: 'Docker', link: '/core-skills/docker' },
          { text: 'Bash', link: '/core-skills/bash' },
          { text: 'HTML & CSS', link: '/core-skills/html-css' },
        ],
      },
      {
        text: '💼 求职准备',
        collapsed: true,
        items: [
          { text: '简历怎么写', link: '/career/resume' },
          { text: '面试准备', link: '/career/interview' },
          { text: '实习与校招', link: '/career/internship' },
          { text: '刷题指南', link: '/career/leetcode' },
        ],
      },
      {
        text: '📚 学习资料',
        collapsed: true,
        items: [
          { text: '书籍推荐', link: '/resources/books' },
          { text: '网站与课程', link: '/resources/websites' },
          { text: '工具清单', link: '/resources/tools' },
        ],
      },
      {
        text: '贡献与维护',
        items: [
          { text: '如何参与贡献', link: '/contributing/guide' },
          { text: '路线图维护规范', link: '/contributing/maintenance' },
        ],
      },
    ],
    outline: { label: '本页内容', level: [2, 3] },
    lastUpdated: {
      text: '最后更新',
      formatOptions: { dateStyle: 'medium', timeStyle: 'short' },
    },
    editLink: {
      pattern: 'https://github.com/zzuli-dev/learn/edit/main/:path',
      text: '在 GitHub 上编辑此页',
    },
    docFooter: { prev: '上一篇', next: '下一篇' },
  },
})

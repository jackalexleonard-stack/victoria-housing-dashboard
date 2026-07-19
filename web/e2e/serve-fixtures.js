import { cpSync, mkdirSync } from 'node:fs'
mkdirSync('dist/data', { recursive: true })
cpSync('src/test/fixtures/site.real.json', 'dist/data/site.json')
cpSync('src/test/fixtures/news.real.json', 'dist/data/news.json')

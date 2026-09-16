import { readFile, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'

function argument(name, fallback = '') {
  const prefix = `--${name}=`
  return process.argv.find((value) => value.startsWith(prefix))?.slice(prefix.length) ?? fallback
}

const input = argument('input')
if (!input) throw new Error('Use --input=<altgrid-diagnostico.json>')
const output = resolve(argument('output', 'performance-result'))
const report = JSON.parse(await readFile(resolve(input), 'utf8'))
const samples = Array.isArray(report.samples) ? report.samples : []
if (!samples.length) throw new Error('O relatório não contém amostras.')

const categories = ['ALTGRID_OVERHEAD', 'GAME_RENDERER', 'GPU', 'CHROMIUM_SERVICES', 'UNKNOWN']
const finite = (value) => Number.isFinite(Number(value)) ? Number(value) : 0
const percentile = (values, ratio) => {
  const sorted = [...values].sort((a, b) => a - b)
  return sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * ratio))] ?? 0
}
const rows = samples.map((sample) => {
  const row = {
    timestamp: sample.generatedAt,
    accounts: sample.sessions?.length ?? 0,
    mode: sample.performanceMode ?? 'unknown',
    parking: [...new Set((sample.sessions ?? []).map((item) => item.parkingStrategy).filter(Boolean))].join('+') || 'unknown',
    processCount: sample.processes?.length ?? 0,
    cpuPercent: (sample.processes ?? []).reduce((sum, item) => sum + finite(item.cpuPercent), 0),
    electronKb: (sample.processes ?? []).reduce((sum, item) => sum + finite(item.privateKb), 0),
    crashes: (sample.sessions ?? []).filter((item) => item.status === 'crashed').length,
    processRecreations: (sample.sessions ?? []).filter((item) => item.processRecreated).length,
    unexpectedNavigations: (sample.sessions ?? []).filter((item) => item.unexpectedNavigation).length,
  }
  for (const category of categories) {
    row[`${category}Kb`] = (sample.processes ?? [])
      .filter((item) => item.classification === category)
      .reduce((sum, item) => sum + finite(item.privateKb), 0)
  }
  return row
})

const values = (key) => rows.map((row) => finite(row[key]))
const summary = {
  schemaVersion: 1,
  source: resolve(input),
  scenario: {
    build: argument('build', 'not specified'),
    accounts: argument('accounts', String(rows.at(-1)?.accounts ?? 'not measured')),
    mode: argument('mode', rows.at(-1)?.mode ?? 'not measured'),
    parking: argument('parking', rows.at(-1)?.parking ?? 'not measured'),
    duration: argument('duration', 'not measured'),
  },
  samples: rows.length,
  firstTimestamp: rows[0]?.timestamp,
  lastTimestamp: rows.at(-1)?.timestamp,
  metrics: Object.fromEntries(['electronKb', 'ALTGRID_OVERHEADKb', 'GAME_RENDERERKb', 'GPUKb', 'CHROMIUM_SERVICESKb', 'UNKNOWNKb', 'cpuPercent'].map((key) => [key, {
    start: values(key)[0] ?? 0, end: values(key).at(-1) ?? 0,
    min: Math.min(...values(key)), max: Math.max(...values(key)),
    average: values(key).reduce((sum, value) => sum + value, 0) / rows.length,
    p95: percentile(values(key), 0.95),
  }])),
  lifecycle: {
    crashes: rows.reduce((sum, row) => sum + row.crashes, 0),
    processRecreations: rows.reduce((sum, row) => sum + row.processRecreations, 0),
    unexpectedNavigations: rows.reduce((sum, row) => sum + row.unexpectedNavigations, 0),
  },
  note: 'Game connection/heartbeat and GPU utilization require observation outside this report.',
}

const headers = Object.keys(rows[0])
const csv = [headers.join(','), ...rows.map((row) => headers.map((key) => JSON.stringify(row[key] ?? '')).join(','))].join('\n')
await writeFile(`${output}.json`, `${JSON.stringify(summary, null, 2)}\n`)
await writeFile(`${output}.csv`, `${csv}\n`)
console.log(`Generated ${output}.json and ${output}.csv from ${rows.length} samples.`)

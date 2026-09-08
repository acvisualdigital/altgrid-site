(function () {
  'use strict'
  if (window.__altgridDpsUi) return
  window.__altgridDpsUi = true
  const VERSION = '1.0.1'
  const UI_KEY = 'altgrid.dps.ui.v1'
  const ui = Object.assign({ collapsed: false, left: null, top: null }, loadUi())
  const colors = { sorcerer: '#ef7777', druid: '#58d889', paladin: '#f3c75f', knight: '#8fb8e8' }
  const rows = new Map()
  let lastSnapshot = null
  function syncUiState() {
    window.postMessage({ __altgridDpsCommand: 'ui-state', suspended: ui.collapsed || document.hidden }, '*')
    if (!ui.collapsed && !document.hidden && lastSnapshot) render(lastSnapshot)
  }

  function loadUi() {
    try { return JSON.parse(localStorage.getItem(UI_KEY)) || {} } catch { return {} }
  }
  function saveUi() {
    try { localStorage.setItem(UI_KEY, JSON.stringify(ui)) } catch {}
  }
  function escapeHtml(value) {
    return String(value == null ? '' : value).replace(/[&<>"]/g, (character) => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;',
    })[character])
  }
  function number(value) { return Math.round(value || 0).toLocaleString('pt-BR') }
  function duration(ms) {
    const seconds = Math.floor(ms / 1000)
    return `${String(Math.floor(seconds / 60)).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}`
  }
  function setText(element, value) {
    if (element.textContent !== value) element.textContent = value
  }
  function render(snapshot) {
    if (ui.collapsed || document.hidden) return
    const party = snapshot.party
    const list = document.getElementById('altgrid-dps-list')
    const footer = document.getElementById('altgrid-dps-footer')
    if (!list || !footer) return
    const warning = snapshot.incomplete ? 'Medição parcial por sobrecarga · zere para reiniciar. ' : ''
    if (!party || !party.rows.length) {
      if (rows.size || !list.querySelector('.altgrid-dps-empty')) {
        list.innerHTML = '<div class="altgrid-dps-empty">Aguardando combate…</div>'
        rows.clear()
      }
      setText(footer, warning || 'Entre em uma hunt para iniciar')
      return
    }
    list.querySelector('.altgrid-dps-empty')?.remove()
    const visible = new Set()
    party.rows.forEach((row, index) => {
      const key = String(row.id ?? row.name)
      visible.add(key)
      let elements = rows.get(key)
      if (!elements) {
        const node = document.createElement('div')
        node.className = 'altgrid-dps-row'
        node.innerHTML = '<div class="altgrid-dps-name"></div><div class="altgrid-dps-bar"><span></span></div><div class="altgrid-dps-value"><b></b><small></small></div>'
        elements = { node, name: node.querySelector('.altgrid-dps-name'), bar: node.querySelector('.altgrid-dps-bar span'), damage: node.querySelector('.altgrid-dps-value b'), detail: node.querySelector('.altgrid-dps-value small') }
        rows.set(key, elements)
      }
      const percentage = Math.round(row.share * 100)
      const color = colors[row.voc] || '#a7b5c4'
      setText(elements.name, String(row.name ?? ''))
      setText(elements.damage, number(row.dmg))
      setText(elements.detail, `${percentage}% · ${number(row.dps)}/s${row.taken > 0 ? ` · -${number(row.taken)}` : ''}`)
      if (elements.name.dataset.vocation !== String(row.voc ?? '')) {
        elements.name.dataset.vocation = String(row.voc ?? '')
        elements.name.title = String(row.voc ?? '')
        elements.name.style.color = color
        elements.bar.style.background = color
      }
      const width = `${percentage}%`
      if (elements.bar.style.width !== width) elements.bar.style.width = width
      if (list.children[index] !== elements.node) list.insertBefore(elements.node, list.children[index] ?? null)
    })
    for (const [key, elements] of rows) {
      if (!visible.has(key)) { elements.node.remove(); rows.delete(key) }
    }
    setText(footer, `${warning}${duration(party.ms)} · total ${number(party.total)} · grupo ${number(party.dps)}/s`)
  }
  window.addEventListener('message', (event) => {
    if (event.source === window && event.data?.__altgridDps) {
      lastSnapshot = event.data
      render(lastSnapshot)
    }
  })
  function build() {
    if (document.getElementById('altgrid-dps-panel')) return
    const panel = document.createElement('aside')
    panel.id = 'altgrid-dps-panel'
    panel.setAttribute('aria-label', 'AltGrid DPS Meter')
    panel.innerHTML = `<button id="altgrid-dps-header" type="button"><span><b>AG</b> DPS Meter</span><small>v${VERSION} ▾</small></button><div id="altgrid-dps-body"><div id="altgrid-dps-list"><div class="altgrid-dps-empty">Aguardando combate…</div></div><div id="altgrid-dps-footer">Entre em uma hunt para iniciar</div><button id="altgrid-dps-reset" type="button">Zerar medição</button></div>`
    document.body.appendChild(panel)
    const body = panel.querySelector('#altgrid-dps-body')
    const header = panel.querySelector('#altgrid-dps-header')
    body.hidden = ui.collapsed
    function keepInsideViewport(left, top) {
      return {
        left: Math.max(8, Math.min(left, window.innerWidth - panel.offsetWidth - 8)),
        top: Math.max(8, Math.min(top, window.innerHeight - panel.offsetHeight - 8)),
      }
    }
    function applySavedPosition() {
      if (!Number.isFinite(ui.left) || !Number.isFinite(ui.top)) return
      const position = keepInsideViewport(ui.left, ui.top)
      panel.style.left = `${position.left}px`
      panel.style.top = `${position.top}px`
      panel.style.right = 'auto'
      panel.style.bottom = 'auto'
    }
    applySavedPosition()
    let drag = null
    header.addEventListener('pointerdown', (event) => {
      if (event.button !== 0) return
      const bounds = panel.getBoundingClientRect()
      drag = { id: event.pointerId, moved: false, offsetX: event.clientX - bounds.left, offsetY: event.clientY - bounds.top }
      header.setPointerCapture(event.pointerId)
      panel.classList.add('is-dragging')
      event.preventDefault()
    })
    header.addEventListener('pointermove', (event) => {
      if (!drag || drag.id !== event.pointerId) return
      const position = keepInsideViewport(event.clientX - drag.offsetX, event.clientY - drag.offsetY)
      drag.moved ||= Math.abs(position.left - panel.getBoundingClientRect().left) > 3 || Math.abs(position.top - panel.getBoundingClientRect().top) > 3
      panel.style.left = `${position.left}px`
      panel.style.top = `${position.top}px`
      panel.style.right = 'auto'
      panel.style.bottom = 'auto'
    })
    function finishDrag(event) {
      if (!drag || drag.id !== event.pointerId) return
      const moved = drag.moved
      drag = null
      panel.classList.remove('is-dragging')
      if (header.hasPointerCapture(event.pointerId)) header.releasePointerCapture(event.pointerId)
      if (moved) {
        const bounds = panel.getBoundingClientRect()
        ui.left = Math.round(bounds.left)
        ui.top = Math.round(bounds.top)
        saveUi()
      } else {
        ui.collapsed = !ui.collapsed
        body.hidden = ui.collapsed
        saveUi()
        syncUiState()
      }
    }
    header.addEventListener('pointerup', finishDrag)
    header.addEventListener('pointercancel', finishDrag)
    window.addEventListener('resize', () => {
      if (!Number.isFinite(ui.left) || !Number.isFinite(ui.top)) return
      const position = keepInsideViewport(ui.left, ui.top)
      ui.left = Math.round(position.left)
      ui.top = Math.round(position.top)
      applySavedPosition()
      saveUi()
    })
    panel.querySelector('#altgrid-dps-reset').addEventListener('click', () => {
      window.postMessage({ __altgridDpsCommand: 'reset' }, '*')
    })
    syncUiState()
  }
  document.addEventListener('visibilitychange', syncUiState)
  if (document.body) build()
  else window.addEventListener('DOMContentLoaded', build, { once: true })
})()

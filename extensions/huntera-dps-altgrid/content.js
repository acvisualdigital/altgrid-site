(function () {
  'use strict'
  const VERSION = '1.0.0'
  const UI_KEY = 'altgrid.dps.ui.v1'
  const ui = Object.assign({ collapsed: false, left: null, top: null }, loadUi())
  const colors = { sorcerer: '#ef7777', druid: '#58d889', paladin: '#f3c75f', knight: '#8fb8e8' }

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
  function render(party) {
    const list = document.getElementById('altgrid-dps-list')
    const footer = document.getElementById('altgrid-dps-footer')
    if (!list || !footer) return
    if (!party || !party.rows.length) {
      list.innerHTML = '<div class="altgrid-dps-empty">Aguardando combate…</div>'
      footer.textContent = 'Entre em uma hunt para iniciar'
      return
    }
    list.innerHTML = party.rows.map((row) => {
      const percentage = Math.round(row.share * 100)
      const color = colors[row.voc] || '#a7b5c4'
      return `<div class="altgrid-dps-row"><div class="altgrid-dps-name" style="color:${color}" title="${escapeHtml(row.voc || '')}">${escapeHtml(row.name)}</div><div class="altgrid-dps-bar"><span style="width:${percentage}%;background:${color}"></span></div><div class="altgrid-dps-value">${number(row.dmg)}<small>${percentage}% · ${number(row.dps)}/s${row.taken > 0 ? ` · <i>-${number(row.taken)}</i>` : ''}</small></div></div>`
    }).join('')
    footer.textContent = `${duration(party.ms)} · total ${number(party.total)} · grupo ${number(party.dps)}/s`
  }
  window.addEventListener('message', (event) => {
    if (event.source === window && event.data?.__altgridDps) render(event.data.party)
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
  }
  if (document.body) build()
  else window.addEventListener('DOMContentLoaded', build, { once: true })
})()

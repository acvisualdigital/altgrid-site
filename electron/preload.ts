import { contextBridge, ipcRenderer } from 'electron'

import {
  IPC_CHANNELS,
  type AltgridDesktopApi,
  type SessionBounds,
  type SessionEvent,
  type SessionProxyInput,
  type SessionProxySummary,
  type SessionProxyTestResult,
  type SessionResourceUsage,
  type SessionSnapshot,
  type UpdateState,
} from './contracts.js'

function invoke<T>(channel: string, ...args: unknown[]): Promise<T> {
  return ipcRenderer.invoke(channel, ...args) as Promise<T>
}

const api: AltgridDesktopApi = Object.freeze({
  app: Object.freeze({
    getPlatform: () => invoke<string>(IPC_CHANNELS.app.getPlatform),
    getVersion: () => invoke<string>(IPC_CHANNELS.app.getVersion),
    openExternal: (url: string) => (
      invoke<boolean>(IPC_CHANNELS.app.openExternal, url)
    ),
  }),
  sessions: Object.freeze({
    clearData: (accountId: string) => (
      invoke<boolean>(IPC_CHANNELS.sessions.clearData, accountId)
    ),
    closeSession: (accountId: string) => (
      invoke<boolean>(IPC_CHANNELS.sessions.close, accountId)
    ),
    createSession: (
      accountId: string,
      url: string,
      useStoredProxy = false,
      stonegyBotEnabled = false,
    ) => (
      invoke<SessionSnapshot>(
        IPC_CHANNELS.sessions.create,
        accountId,
        url,
        useStoredProxy,
        stonegyBotEnabled,
      )
    ),
    destroySession: (accountId: string) => (
      invoke<boolean>(IPC_CHANNELS.sessions.destroy, accountId)
    ),
    focusSession: (accountId: string) => (
      invoke<SessionSnapshot>(IPC_CHANNELS.sessions.focus, accountId)
    ),
    getSessions: () => (
      invoke<SessionSnapshot[]>(IPC_CHANNELS.sessions.getAll)
    ),
    getProxy: (accountId: string) => (
      invoke<SessionProxySummary | null>(IPC_CHANNELS.sessions.getProxy, accountId)
    ),
    getResourceUsage: () => (
      invoke<SessionResourceUsage[]>(IPC_CHANNELS.sessions.getResourceUsage)
    ),
    hideSession: (accountId: string) => (
      invoke<SessionSnapshot>(IPC_CHANNELS.sessions.hide, accountId)
    ),
    muteSession: (accountId: string, muted: boolean) => (
      invoke<SessionSnapshot>(IPC_CHANNELS.sessions.mute, accountId, muted)
    ),
    navigateSession: (accountId: string, url: string) => (
      invoke<SessionSnapshot>(IPC_CHANNELS.sessions.navigate, accountId, url)
    ),
    onEvent: (listener: (event: SessionEvent) => void) => {
      const wrapped = (_event: Electron.IpcRendererEvent, payload: SessionEvent) => {
        listener(payload)
      }
      ipcRenderer.on(IPC_CHANNELS.sessions.event, wrapped)
      return () => ipcRenderer.removeListener(IPC_CHANNELS.sessions.event, wrapped)
    },
    reloadSession: (accountId: string) => (
      invoke<SessionSnapshot>(IPC_CHANNELS.sessions.reload, accountId)
    ),
    removeProxy: (accountId: string) => (
      invoke<boolean>(IPC_CHANNELS.sessions.removeProxy, accountId)
    ),
    resizeSession: (accountId: string, bounds: SessionBounds) => (
      invoke<SessionSnapshot>(IPC_CHANNELS.sessions.resize, accountId, bounds)
    ),
    setEcoMode: (enabled: boolean, secondaryFps?: number) => (
      secondaryFps === undefined
        ? invoke<boolean>(IPC_CHANNELS.sessions.setEcoMode, enabled)
        : invoke<boolean>(IPC_CHANNELS.sessions.setEcoMode, enabled, secondaryFps)
    ),
    setFrameRate: (accountId: string, fps: number) => (
      invoke<SessionSnapshot>(IPC_CHANNELS.sessions.setFrameRate, accountId, fps)
    ),
    setInterfaceZoom: (accountId: string, zoom: number | null) => (
      invoke<SessionSnapshot>(IPC_CHANNELS.sessions.setInterfaceZoom, accountId, zoom)
    ),
    setStonegyBot: (accountId: string, enabled: boolean) => (
      invoke<SessionSnapshot>(IPC_CHANNELS.sessions.setStonegyBot, accountId, enabled)
    ),
    setProxy: (accountId: string, input: SessionProxyInput) => (
      invoke<SessionProxySummary>(IPC_CHANNELS.sessions.setProxy, accountId, input)
    ),
    showSession: (accountId: string) => (
      invoke<SessionSnapshot>(IPC_CHANNELS.sessions.show, accountId)
    ),
    testProxy: (accountId: string) => (
      invoke<SessionProxyTestResult>(IPC_CHANNELS.sessions.testProxy, accountId)
    ),
  }),
  updater: Object.freeze({
    checkForUpdates: () => invoke<UpdateState>(IPC_CHANNELS.updater.check),
    downloadUpdate: () => invoke<UpdateState>(IPC_CHANNELS.updater.download),
    getState: () => invoke<UpdateState>(IPC_CHANNELS.updater.getState),
    onStateChange: (listener: (state: UpdateState) => void) => {
      const wrapped = (_event: Electron.IpcRendererEvent, payload: UpdateState) => {
        listener(payload)
      }
      ipcRenderer.on(IPC_CHANNELS.updater.event, wrapped)
      return () => ipcRenderer.removeListener(IPC_CHANNELS.updater.event, wrapped)
    },
    quitAndInstall: () => invoke<boolean>(IPC_CHANNELS.updater.install),
  }),
})

contextBridge.exposeInMainWorld('altgrid', api)

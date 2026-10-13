import { contextBridge, ipcRenderer } from "electron";
import type { StudioAPI } from "../../../../packages/contracts/src/index";
// Each method has a fixed channel. There is deliberately no generic IPC API.
const api: StudioAPI = {
  licenseStatus: () => ipcRenderer.invoke("studio:licenseStatus"),
  licenseLogin: () => ipcRenderer.invoke("studio:licenseLogin"),
  licenseActivate: (key) => ipcRenderer.invoke("studio:licenseActivate", key),
  licenseLogout: () => ipcRenderer.invoke("studio:licenseLogout"),
  licenseDeactivate: () => ipcRenderer.invoke("studio:licenseDeactivate"),
  licenseOpenStore: () => ipcRenderer.invoke("studio:licenseOpenStore"),
  stopAll: () => ipcRenderer.invoke("studio:stopAll"),
  listJobs: (input) => ipcRenderer.invoke("studio:listJobs", input),
  exportSupportBundle: () => ipcRenderer.invoke("studio:exportSupportBundle"),
  cleanArtifacts: () => ipcRenderer.invoke("studio:cleanArtifacts"),
  getEnvironment: (id) => ipcRenderer.invoke("studio:getEnvironment", id),
  setEnvironment: (input) => ipcRenderer.invoke("studio:setEnvironment", input),
  getPlan: (input) => ipcRenderer.invoke("studio:getPlan", input),
  controlPlan: (input) => ipcRenderer.invoke("studio:controlPlan", input),
  getArtifact: (input) => ipcRenderer.invoke("studio:getArtifact", input),
  importSkills: (input) => ipcRenderer.invoke("studio:importSkills", input),
  configureSkill: (input) => ipcRenderer.invoke("studio:configureSkill", input),
  inspectSkill: (input) => ipcRenderer.invoke("studio:inspectSkill", input),
  tunnelStatus: () => ipcRenderer.invoke("studio:tunnelStatus"),
  saveTunnel: (input) => ipcRenderer.invoke("studio:saveTunnel", input),
  startTunnel: () => ipcRenderer.invoke("studio:startTunnel"),
  stopTunnel: () => ipcRenderer.invoke("studio:stopTunnel"),
  testTunnel: () => ipcRenderer.invoke("studio:testTunnel"),
  forgetTunnel: () => ipcRenderer.invoke("studio:forgetTunnel"),
  selectTunnelRuntime: () => ipcRenderer.invoke("studio:selectTunnelRuntime"),
  openChatGPT: () => ipcRenderer.invoke("studio:openChatGPT"),
  snapshot: () => ipcRenderer.invoke("studio:snapshot"),
  addFolders: () => ipcRenderer.invoke("studio:addFolders"),
  reauthorizeWorkspace: (id) =>
    ipcRenderer.invoke("studio:reauthorizeWorkspace", id),
  updateWorkspace: (input) =>
    ipcRenderer.invoke("studio:updateWorkspace", input),
  removeWorkspace: (id) => ipcRenderer.invoke("studio:removeWorkspace", id),
  openWorkspace: (id) => ipcRenderer.invoke("studio:openWorkspace", id),
  setSettings: (input) => ipcRenderer.invoke("studio:setSettings", input),
  setModule: (input) => ipcRenderer.invoke("studio:setModule", input),
  resolveChange: (input) => ipcRenderer.invoke("studio:resolveChange", input),
  getChange: (id) => ipcRenderer.invoke("studio:getChange", id),
  getJob: (id) => ipcRenderer.invoke("studio:getJob", id),
  resolveJob: (input) => ipcRenderer.invoke("studio:resolveJob", input),
  createConnection: (input) =>
    ipcRenderer.invoke("studio:createConnection", input),
  updateConnection: (input) =>
    ipcRenderer.invoke("studio:updateConnection", input),
  testConnection: (id) => ipcRenderer.invoke("studio:testConnection", id),
  revokeConnection: (id) => ipcRenderer.invoke("studio:revokeConnection", id),
  installConnection: (input) =>
    ipcRenderer.invoke("studio:installConnection", input),
  runCommand: (input) => ipcRenderer.invoke("studio:runCommand", input),
  readFile: (input) => ipcRenderer.invoke("studio:readFile", input),
  proposeFile: (input) => ipcRenderer.invoke("studio:proposeFile", input),
  openExternal: (url) => ipcRenderer.invoke("studio:openExternal", url),
  onChange: (callback) => {
    const listener = () => callback();
    ipcRenderer.on("studio:changed", listener);
    return () => ipcRenderer.removeListener("studio:changed", listener);
  },
};
contextBridge.exposeInMainWorld("studio", api);
for (const [eventName, key] of [
  ["palette", "studio:palette"],
  ["settings", "studio:settings"],
  ["activity", "studio:activity"],
])
  ipcRenderer.on(key, () =>
    window.dispatchEvent(new CustomEvent("studio:" + eventName)),
  );

import { useAppStore } from "../../store/appStore";

export function resetAppStoreForTest() {
  useAppStore.setState({
    packages: [],
    settings: {
      downloadDir: "~/Downloads",
      theme: "system",
      autoDownloadMaxBytes: 1024 * 1024 * 1024,
      autoInstallUpdates: true,
      sizeUnit: "jedec",
    },
    receiveDraftTicket: "",
    autoPreviewedClipboardTicket: null,
    autoFilledClipboardTicket: null,
  });
}

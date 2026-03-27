import { useAppStore } from "../../store/appStore";
import { TEST_DOWNLOAD_DIR } from "./paths";

export function resetAppStoreForTest() {
  useAppStore.setState({
    packages: [],
    settings: {
      downloadDir: TEST_DOWNLOAD_DIR,
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

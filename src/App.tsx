import { useState } from "react";
import { invoke } from "@tauri-apps/api/tauri";
import { open as openFileDialog } from "@tauri-apps/api/dialog";
import toast, { Toaster } from "react-hot-toast";
import "./App.css";
import { Tabs } from '@mui/base/Tabs';
import { TabsList } from '@mui/base/TabsList';
import { TabPanel } from '@mui/base/TabPanel';
import { Tab, TabOwnerState, TabProps } from '@mui/base/Tab';

interface GetShareCodeResponse {
  doc_ticket: string;
}

function QuickSendTab(props: TabProps) {
  const slotProps = {
    root: (ownerState: TabOwnerState) => ({
      className: `${
        ownerState.selected ? 'bg-amber-600 border-amber-600' : 'bg-inherit border-slate-700'
      }`,
    }),
  };

  return <Tab {...props} slotProps={slotProps} />;
}

function App() {
  const [blobTicket, setBlobTicket] = useState("");
  const [docTicket, setDocTicket] = useState("");
  const [pathsSelected, setPathsSelected] = useState<string[]>([]);
  const [downloadButtonEnabled, setDownloadButtonEnabled] = useState(true);

  async function get_blob() {
    let toast_id = toast.loading("Downloading ...");
    setDownloadButtonEnabled(false);
    invoke<string>("get_blob", {
      getBlobRequest: { blob_ticket: blobTicket },
    }).then(
      (msg) => {
        toast.success(<p>{msg}</p>, {
          id: toast_id,
        });
      },
      (err) => {
        toast.error(<b>{err}</b>, {
          id: toast_id,
        });
      },
    ).finally(() => {
      setDownloadButtonEnabled(true);
    });
  }

  async function get_share_code(paths: string[]) {
    let r: GetShareCodeResponse = await invoke("get_share_code", {
      getShareCodeRequest: { files: paths },
    });
    if (r["doc_ticket"]) {
      setDocTicket(r["doc_ticket"]);
    } else {
      console.error(r);
    }
  }

  async function show_file_dialog() {
    openFileDialog({
      title: "Select the files to be sent",
      multiple: true,
    })
      .then(async (paths) => {
        if (paths === null || paths instanceof String) {
          return;
        }
        const all_paths = [...new Set([...pathsSelected, ...paths])];
        setPathsSelected(all_paths);
        await get_share_code(all_paths);
      })
      .catch(console.error);
  }

  async function removePath(path: string) {
    const pathsSelectedFiltered = pathsSelected.filter((p) => p != path);
    setPathsSelected(pathsSelectedFiltered);
    if (pathsSelectedFiltered.length > 0) {
      get_share_code(pathsSelectedFiltered);
    } else {
      setDocTicket("");
    }
  }

  return (
    <div className="flex flex-col gap-12 my-12">
      <Tabs defaultValue={0} className="flex flex-col">
        <TabsList className="flex w-fit self-center gap-4 pb-8">
          <QuickSendTab value={0} className="hover:bg-amber-600 hover:border-amber-600 text-gray-300 border-4 py-3 px-4 rounded-2xl">Send</QuickSendTab>
          <QuickSendTab value={1} className="hover:bg-amber-600 hover:border-amber-600 text-gray-300 border-4 py-3 px-4 rounded-2xl">Receive</QuickSendTab>
        </TabsList>
        <TabPanel value={0}>
          <form
            className="self-center flex flex-col p-3 gap-5"
            onSubmit={(e) => {
              e.preventDefault();
            }}
          >
            <h2 className="text-3xl text-center dark:text-gray-300">Send</h2>
            <button
              className="w-fit self-center p-3 rounded-2xl border-4 border-slate-700 hover:bg-slate-700 hover:text-slate-50 dark:text-gray-300"
              onClick={show_file_dialog}
            >
              {pathsSelected.length == 0 ? "Select files" : "Select more files"}
            </button>

            {pathsSelected.length == 0 ? null : (
              <div className="flex flex-col gap-2 rounded-xl border-2 border-gray-300 dark:border-gray-700 p-4">
                {pathsSelected.map((p, index) => {
                  return (
                    <div className="flex flex-row place-content-between p-1" key={index}>
                      <p className="dark:text-gray-300">{p}</p>
                      <div
                        className="hover:cursor-pointer"
                        onClick={() => {
                          removePath(p);
                        }}
                      >
                        🗑️
                      </div>
                    </div>
                  );
                })}
              </div>
            )}

            {docTicket ? (
              <div className="flex flex-col">
                <h3 className="dark:text-gray-300 self-center">
                  Super secret code
                </h3>
                <p className="dark:text-gray-300 text-wrap break-words">
                  {docTicket}
                </p>
              </div>
            ) : null}
          </form>
        </TabPanel>
        <TabPanel value={1}>
          <form
            className="self-center flex flex-col p-3 gap-5"
            onSubmit={(e) => {
              e.preventDefault();
              get_blob();
            }}
          >
            <h2 className="text-3xl text-center dark:text-gray-300">Receive</h2>
            <input
              className="p-3 rounded-2xl border-4 border-slate-700"
              onChange={(e) => setBlobTicket(e.currentTarget.value)}
              type="password"
              placeholder="Paste the secret here"
            />
            <button
              className="p-3 rounded-2xl border-4 border-slate-700 hover:bg-slate-700 hover:text-slate-50 dark:text-gray-300 disabled:text-gray-400 disabled:hover:bg-inherit disabled:border-slate-200 disabled:dark:text-gray-700 disabled:dark:hover:bg-inherit disabled:dark:border-slate-800"
              type="submit"
              disabled={!downloadButtonEnabled}
            >
              Download
            </button>
          </form>
        </TabPanel>
      </Tabs>

      <Toaster
        position="bottom-center"
        toastOptions={{
          className: "",
          duration: 5000,
          style: {
            background: "#363636",
            color: "#fff",
          },
        }}
      />
    </div>
  );
}

export default App;

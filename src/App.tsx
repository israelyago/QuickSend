import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/tauri";
import { useAppDispatch, useAppSelector } from "./hooks";
import { open as openFileDialog } from "@tauri-apps/api/dialog";
import toast, { Toaster } from "react-hot-toast";
import "./App.css";
import { Tabs } from '@mui/base/Tabs';
import { TabsList } from '@mui/base/TabsList';
import { TabPanel } from '@mui/base/TabPanel';
import { Tab, TabOwnerState, TabProps } from '@mui/base/Tab';
import { listen } from "@tauri-apps/api/event";
import { appendDownloadable, clearDownloadablesList, doneDownloadable, Downloadable, DownloadableDone, DownloadableProgress, progressDownloadable } from "./features/receiver/receiver-slide";
import { nanoid } from "nanoid";
import LinearProgress, { LinearProgressProps } from '@mui/material/LinearProgress';
import Typography from "@mui/material/Typography";
import Box from "@mui/material/Box";
import { appendUploadable, progressUploadable, removeUploadable, Uploadable, UploadableProgress } from "./features/sender/sender-slide";
import { ClipboardDocumentListIcon, TrashIcon, CheckIcon } from '@heroicons/react/24/outline'

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
  const [downloadButtonEnabled, setDownloadButtonEnabled] = useState(true);

  const downloadables = useAppSelector((state) => state.receiver.queue);
  const uploadables = useAppSelector((state) => state.sender.queue);
  const dispatch = useAppDispatch();

  useEffect(() => {
    const unlistenUploaderAppend = listen<{id: string, title: string, size: number}>('upload-queue-append', (event) => {
      if (uploadables.findIndex(u => u.url == event.payload.title) != -1) {
        return;
      }
      const element: Uploadable = {
        unique_id: nanoid(),
        id: event.payload.id,
        url: event.payload.title,
        size: event.payload.size,
        progress: 0,
      }
      dispatch(appendUploadable(element))
    });

    const unlistenUploaderProgress = listen<{id: string, offset: number}>('upload-queue-progress', (event) => {
      const element: UploadableProgress = {
        id: event.payload.id,
        progress: event.payload.offset,
      }
      dispatch(progressUploadable(element))
    });

    const unlistenUploaderAllDone = listen<{id: string}>('upload-queue-alldone', (event) => {
      const element = uploadables.find(u => u.id == event.payload.id);
      if (element === undefined) {
        return;
      }
      const updatedElement: UploadableProgress = {
        id: element.id,
        progress: element.size,
      };
      dispatch(progressUploadable(updatedElement))
    });

    const unlistenDownloaderAppend = listen<{id: string, name: string, size: number}>('download-queue-append', (event) => {
      const downloadable: Downloadable = {
        unique_id: nanoid(),
        id: event.payload.id,
        title: event.payload.name,
        size: event.payload.size,
        progress: 0,
      }
      dispatch(appendDownloadable(downloadable))
    });

    const unlistenDownloaderProgress = listen<{id: string, offset: number}>('download-queue-progress', (event) => {
      const downloadable: DownloadableProgress = {
        id: event.payload.id,
        progress: event.payload.offset,
      }
      dispatch(progressDownloadable(downloadable))
    });

    const unlistenDownloaderDone = listen<string>('download-queue-done', (event) => {
      const downloadable: DownloadableDone = {
        id: event.payload,
      }
      dispatch(doneDownloadable(downloadable))
    });
    return () => {
      unlistenUploaderAppend.then(f => f());
      unlistenUploaderProgress.then(f => f());
      unlistenUploaderAllDone.then(f => f());

      unlistenDownloaderAppend.then(f => f());
      unlistenDownloaderProgress.then(f => f());
      unlistenDownloaderDone.then(f => f());
    };
  }, []);

  async function get_blob() {
    dispatch(clearDownloadablesList());

    let toast_id = toast.loading("Downloading ...", {
      duration: Infinity,
    });
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
      setTimeout(() => {
        toast.dismiss(toast_id);
      }, 5 * 1000);
      setDownloadButtonEnabled(true);
    });
  }

  async function get_share_code() {
    let r: GetShareCodeResponse = await invoke("get_share_code");
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

        const p = paths as string[];

        p.forEach(path => {
          invoke("append_file", {
            appendFileRequest: { file_path: path },
          }).then(
            () => {},
            toast.error,
          );
        })

        await get_share_code();
      })
      .catch(console.error);
  }

  async function removePath(path: string) {

    const element = uploadables.find(u => u.url == path);
    if (element === undefined) {
      return;
    }

    invoke("remove_file", {
      removeFileRequest: { file_path: path },
    }).then(
      () => {},
      console.error,
    );
  }

  function shouldShowShareCode(): boolean {
    if (uploadables.length == 0) return false;
    const shouldHideShareCode = uploadables.some(u => u.progress != u.size)
    return !shouldHideShareCode;
  }

  function copySecretToClipBoard(_event: any) {
    navigator.clipboard.writeText(docTicket);
    toast.success("Copied to clipboard", {
      duration: 2000,
    });
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
              {uploadables.length == 0 ? "Select files" : "Select more files"}
            </button>

            {uploadables.map((uploadable) => (
            <div className="flex flex-col rounded-2xl border-4 p-4 border-slate-700" key={uploadable.unique_id}>
              <div className="flex justify-between">
                <p className="text-gray-300">{uploadable.url}</p>
                { uploadable.progress == uploadable.size ?
                  <div
                  className="hover:cursor-pointer"
                  onClick={() => {
                    removePath(uploadable.url);
                    dispatch(removeUploadable(uploadable.unique_id));
                  }}>
                  <TrashIcon className="size-6 dark:text-gray-300"/>
                </div> : null }
              </div>
              { uploadable.progress == uploadable.size ? null :
                <LinearProgressWithLabel value={(uploadable.progress/uploadable.size)*100} /> }
            </div>
            ))}

            {shouldShowShareCode() ? (
              <div className="flex flex-col items-center gap-2">
                <h3 className="dark:text-gray-300">
                  Super secret code
                </h3>
                  <button className="flex gap-2 rounded-2xl border-4 px-4 py-2 border-slate-700 hover:bg-slate-700" onClick={copySecretToClipBoard}>
                    <p className="w-64 dark:text-gray-300 whitespace-nowrap overflow-hidden overflow-ellipsis self-center">
                      {docTicket}
                    </p>
                    <p className="dark:text-gray-300 uppercase">
                      Copy
                    </p>
                    <ClipboardDocumentListIcon className="size-6 dark:text-gray-300" />
                  </button>
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

          {downloadables.map((downloadable) => (
          <div className="flex flex-col rounded-2xl border-4 p-4 mt-2 border-slate-700" key={downloadable.unique_id}>
            <div className="flex justify-between">
              <p className="text-gray-300" key={downloadable.unique_id}>{downloadable.title}</p>
              { downloadable.progress == downloadable.size ? <div><CheckIcon className="size-6 dark:text-gray-300" /></div> : null }
            </div>
            { downloadable.progress == downloadable.size ? null :
              <LinearProgressWithLabel value={(downloadable.progress/downloadable.size)*100} /> }
          </div>
          ))}
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

function LinearProgressWithLabel(props: LinearProgressProps & { value: number }) {
  return (
    <Box sx={{ display: 'flex', alignItems: 'center' }}>
      <Box sx={{ width: '100%', mr: 1 }}>
        <LinearProgress variant="determinate" {...props} />
      </Box>
      <Box sx={{ minWidth: 35 }}>
        <Typography
          variant="body2"
          className="text-gray-300"
        >{`${Math.round(props.value)}%`}</Typography>
      </Box>
    </Box>
  );
}

export default App;

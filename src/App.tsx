import { useState } from "react";
import { invoke } from "@tauri-apps/api/tauri";
import { open as openFileDialog } from "@tauri-apps/api/dialog";
import toast, { Toaster } from "react-hot-toast";
import "./App.css";

interface GetShareCodeResponse {
  doc_ticket: string;
}

function App() {
  const [blob_ticket, setBlobTicket] = useState("");
  const [doc_ticket, setDocTicket] = useState("");
  const [pathsSelected, setPathsSelected] = useState([""]);

  async function get_blob() {
    let toast_id = toast.loading("Downloading ...");
    invoke<string>("get_blob", {
      getBlobRequest: { blob_ticket: blob_ticket },
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
    );
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

  return (
    <div className="flex flex-col gap-12 my-12">
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

        <div>
          {pathsSelected.map((p) => {
            return <div className="dark:text-gray-300">{p}</div>;
          })}
        </div>

        {doc_ticket ? (
          <div className="">
            <h3 className="dark:text-gray-300">Super secret code:</h3>
            <p className="dark:text-gray-300">{doc_ticket}</p>
          </div>
        ) : null}
      </form>
      <hr className="dark:border-zinc-700" />

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
          className="p-3 rounded-2xl border-4 border-slate-700 hover:bg-slate-700 hover:text-slate-50 dark:text-gray-300"
          type="submit"
        >
          Download
        </button>
      </form>

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

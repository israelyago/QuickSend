import { useState } from "react";
import { invoke } from "@tauri-apps/api/tauri";
import { open as openFileDialog } from "@tauri-apps/api/dialog";
import toast, { Toaster } from 'react-hot-toast';
import "./App.css";

interface GetShareCodeResponse {
  doc_ticket: string,
}

function App() {
  const [blob_ticket, setBlobTicket] = useState("");
  const [doc_ticket, setDocTicket] = useState("");

  async function get_blob() {
    let toast_id = toast.loading("Downloading ...");
    invoke<string>("get_blob", { getBlobRequest: { blob_ticket: blob_ticket } })
    .then(msg => {
      toast.success(<p>{msg}</p>, {
        id: toast_id,
      })
    }, err => {
      toast.error(<b>{err}</b>, {
        id: toast_id,
      })
    });
  }

  async function get_share_code(paths: string[]) {
    let r: GetShareCodeResponse = await invoke("get_share_code", { getShareCodeRequest: { files: paths } });
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
    }).then(async paths => {
      if (paths === null || paths instanceof String) {
        return;
      }
      await get_share_code(paths as string[]);
    }).catch(console.error);
  }

  return (
    <div className="container">
      <form
        className=""
        onSubmit={(e) => {
          e.preventDefault();
        }}
      >
        <h2>Send</h2>
        <button onClick={show_file_dialog}>Select files</button>
      </form>

      {doc_ticket ? <div>
        <h3>Super secret code:</h3>
        <p>{doc_ticket}</p>
      </div>: null}
      <hr style={{width: "100%", color: "#f6f6f620"}} />

      <form
        className=""
        onSubmit={(e) => {
          e.preventDefault();
          get_blob();
        }}
        >
        <h2>Receive</h2>
        <input
          className="mr-1"
          onChange={(e) => setBlobTicket(e.currentTarget.value)}
          type="password"
          placeholder="Paste the secret here"
        />
        <button type="submit">Download</button>
      </form>

      <Toaster
        position="bottom-center"
        toastOptions={{
          className: '',
          duration: 5000,
          style: {
            background: '#363636',
            color: '#fff',
          },
        }}
        />
    </div>
  );
}

export default App;

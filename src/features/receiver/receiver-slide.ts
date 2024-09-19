import { createSlice, PayloadAction } from "@reduxjs/toolkit";

export interface Downloadable {
    unique_id: string,
    id: string,
    title: string,
    size: number,
    progress: number,
}

export interface DownloadableProgress {
    id: string,
    progress: number,
}

export interface DownloadableDone {
    id: string,
}

export interface ReceiverState {
    queue: Downloadable[],
}

const initialState: ReceiverState = {
    queue: [],
};

const receiverSlice = createSlice({
    name: 'receiver',
    initialState,
    reducers: {
        appendDownloadable(state, action: PayloadAction<Downloadable>) {
            state.queue.push(action.payload)
        },
        progressDownloadable(state, action: PayloadAction<DownloadableProgress>) {
            const downloadable = state.queue.find(d => d.id == action.payload.id);
            if (downloadable) {
                downloadable.progress = action.payload.progress;
            }
        },
        doneDownloadable(state, action: PayloadAction<DownloadableDone>) {
            const downloadable = state.queue.find(d => d.id == action.payload.id);
            if (downloadable) {
                downloadable.progress = downloadable.size;
            }
        },
        clearDownloadablesList(state) {
            state.queue = [];
        }
    }
})

export const { appendDownloadable, progressDownloadable, doneDownloadable, clearDownloadablesList } = receiverSlice.actions;
export default receiverSlice.reducer;
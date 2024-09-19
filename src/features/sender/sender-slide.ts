import { createSlice, PayloadAction } from "@reduxjs/toolkit";

export interface Uploadable {
    unique_id: string,
    id: string,
    url: string,
    size: number,
    progress: number,
}

export interface UploadableProgress {
    id: string,
    progress: number,
}

export interface UploadableAllDone {
    id: string,
}

export interface SenderState {
    queue: Uploadable[],
}

const initialState: SenderState = {
    queue: [],
};


const senderSlice = createSlice({
    name: 'sender',
    initialState,
    reducers: {
        appendUploadable(state, action: PayloadAction<Uploadable>) {
            state.queue.push(action.payload)
        },
        progressUploadable(state, action: PayloadAction<UploadableProgress>) {
            const downloadable = state.queue.find(d => d.id == action.payload.id);
            if (downloadable) {
                downloadable.progress = action.payload.progress;
            }
        },
        allDoneUploadable(state, action: PayloadAction<UploadableAllDone>) {
            const downloadable = state.queue.find(d => d.id == action.payload.id);
            if (downloadable) {
                downloadable.progress = downloadable.size;
            }
        },
        removeUploadable(state, action: PayloadAction<string>) {
            state.queue = state.queue.filter(element => element.unique_id != action.payload);
        }
    }
})

export const { appendUploadable, progressUploadable, allDoneUploadable, removeUploadable } = senderSlice.actions;
export default senderSlice.reducer;
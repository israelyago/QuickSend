import { configureStore } from '@reduxjs/toolkit'
import senderReducer from './features/sender/sender-slide'
import receiverReducer from './features/receiver/receiver-slide'


export const store = configureStore({
  reducer: {
    sender: senderReducer,
    receiver: receiverReducer,
  },
})

export type AppDispatch = typeof store.dispatch
export type RootState = ReturnType<typeof store.getState>
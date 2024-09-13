'use client'

import { Loader2 } from "lucide-react";
import Modal from "react-modal";

if (typeof window !== 'undefined') {
    Modal.setAppElement('body');
}

export const UploadingModal = ({
    text = "Uploading file...",
}) => {

    return (
        <div
            className="absolute top-0 left-0 w-full h-full bg-black bg-opacity-50 flex items-center justify-center z-50"
        >
            <div className="flex flex-col items-center justify-center p-6 bg-white rounded-lg shadow-xl">
                <h2 className="text-2xl font-semibold mb-4">{text}</h2>
                <Loader2 className="w-8 h-8 text-blue-500 animate-spin" />
            </div>
        </div>
    )
};
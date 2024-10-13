// Define the list of acceptable models
const acceptableModels = [
    {
        id: "sakura-14b-qwen2.5-v1.0-iq4xs",
        meta: {
            vocab_type: 2,
            n_vocab: 152064,
            n_ctx_train: 131072,
            n_embd: 5120,
            n_params: 14770033664,
            size: 8180228096
        }
    },
    // Add more acceptable models here as needed
];

export async function verifyModel(nodeUrl) {
    try {
        const response = await fetch(`${nodeUrl}/v1/models`);

        if (!response.ok) {
            return false;
        }

        let data;
        try {
            data = await response.json();
        } catch (parseError) {
            console.error('Failed to parse JSON response:', parseError.message);
            return false;
        }

        // Verify the response structure
        if (data.object !== 'list' || !Array.isArray(data.data) || data.data.length === 0) {
            return false;
        }

        // Get the single model object
        const model = data.data[0];

        let isModelAcceptable = false;
        for (const acceptableModel of acceptableModels) {
            if ((model.id === acceptableModel.id || model.id === acceptableModel.id + '.gguf') && model.meta) {
                let allMetaMatch = true;

                for (const [key, value] of Object.entries(acceptableModel.meta)) {
                    if (key in model.meta) {
                        if (model.meta[key] !== value) {
                            allMetaMatch = false;
                            break;
                        }
                    } else {
                        // Key not found in model.meta, consider it a mismatch
                        allMetaMatch = false;
                        break;
                    }
                }

                if (allMetaMatch) {
                    isModelAcceptable = true;
                    break;
                }
            }
        }

        return isModelAcceptable;

    } catch (error) {
        // Any unexpected error
        console.error('Model verification failed:', error.message);
        return false;
    }
}
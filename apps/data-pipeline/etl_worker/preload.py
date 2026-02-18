"""Pre-download OnnxTR model artifacts into the image cache layer."""

import os

from onnxtr.models import EngineConfig, ocr_predictor


def preload_models() -> None:
    det_arch = os.environ.get("ONNXTR_DET_ARCH", "db_resnet50")
    reco_arch = os.environ.get("ONNXTR_RECO_ARCH", "parseq")
    reco_fallback = os.environ.get("ONNXTR_RECO_FALLBACK_ARCH", "crnn_vgg16_bn")
    load_in_8_bit = os.environ.get("ONNXTR_LOAD_IN_8_BIT", "true").strip().lower() in (
        "1",
        "true",
        "yes",
        "on",
    )

    print("Downloading OnnxTR models into cache...")
    engine_config = EngineConfig(providers=["CPUExecutionProvider"])

    model_variants = [(det_arch, reco_arch)]
    if reco_fallback and reco_fallback != reco_arch:
        model_variants.append((det_arch, reco_fallback))

    for det, reco in model_variants:
        print(f"  - caching det={det}, reco={reco}")
        _ = ocr_predictor(
            det_arch=det,
            reco_arch=reco,
            load_in_8_bit=load_in_8_bit,
            det_engine_cfg=engine_config,
            reco_engine_cfg=engine_config,
        )

    print("OnnxTR model cache is ready.")


if __name__ == "__main__":
    preload_models()

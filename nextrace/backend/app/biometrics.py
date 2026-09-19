"""
Biometric investigation extension point.

This prototype deliberately does NOT include an actual biometric recognition model and never
fabricates match scores. Instead it exposes a clean adapter (BiometricsBackend) that a real
matching engine can plug in to later, while the UI/backend honestly report that biometric
analysis is an advanced / future capability until one is connected. Biometric evidence stored
in the system is provenance + metadata only (who, when, where, which modality) - no templates,
no raw biometric data, no fake confidence scores.
"""

BIOMETRIC_MODALITIES = ["face", "fingerprint", "voice"]


class BiometricsBackend:
    """Adapter contract for a future biometric matching engine."""

    name = "BiometricsBackend"
    configured = False

    def extract_template(self, sample_metadata: dict):
        raise NotImplementedError("No biometric engine connected.")

    def match(self, reference: dict, probes: list):
        raise NotImplementedError("No biometric engine connected.")


class UnavailableBiometricsBackend(BiometricsBackend):
    """Honest default: no engine is connected, so no match results are produced."""

    name = "UnavailableBiometricsBackend"
    configured = False

    def match(self, reference: dict, probes: list):
        return {
            "configured": False,
            "match_available": False,
            "reason": ("Biometric analysis is an advanced/future capability in NexTrace. "
                       "No biometric matching engine is connected, so no match results are "
                       "produced. The biometric evidence recorded here is provenance/metadata "
                       "only."),
            "reference": reference,
            "matches": [],
        }


# Registry so a real engine can be registered later without touching call sites.
MATCHER_REGISTRY = {
    "default": UnavailableBiometricsBackend(),
}


def get_biometrics_backend() -> BiometricsBackend:
    return MATCHER_REGISTRY["default"]
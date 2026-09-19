"""
User-authentication biometric extension point (WebAuthn / passkeys).

"Biometric authentication" in NexTrace means AUTHENTICATING AN INVESTIGATOR when they
sign in - via the device's built-in biometric/passkey capability exposed through the
W3C WebAuthn standard (fingerprint, face, security key, Windows Hello, etc.).

This prototype does NOT pretend to run WebAuthn ceremonies and NEVER fabricates a
successful authentication. It exposes a clean backend adapter that a real WebAuthn
relying party (e.g. py_webauthn) can register later, so the working login flow stays
honest (analyst ID + password + JWT) until such a backend is configured. No biometric
templates are ever stored anywhere in the system.

Flows enabled once a relying party is registered:

    user device --> biometric/passkey --> WebAuthn assertion
        --> NexTrace auth gateway (auth.authenticate_with_passkey)
        --> analyst JWT session --> dashboard
"""


class WebAuthnAuthBackend:
    """Adapter contract for a WebAuthn relying party. A real implementation registers a
    challenge for begin_authentication() and cryptographically verifies the assertion in
    verify_authentication() - never a placeholder "always succeeds" branch."""

    name = "WebAuthnAuthBackend"
    configured = False

    def begin_authentication(self, analyst_id: str) -> dict:
        raise NotImplementedError("No WebAuthn relying party is configured.")

    def verify_authentication(self, analyst_id: str, credential_response: dict) -> bool:
        raise NotImplementedError("No WebAuthn relying party is configured.")


class UnavailableWebAuthnBackend(WebAuthnAuthBackend):
    """Honest default: no relying party is connected, so no biometric sign-in is offered."""

    name = "UnavailableWebAuthnBackend"
    configured = False

    def begin_authentication(self, analyst_id: str) -> dict:
        return {
            "configured": False,
            "reason": ("Biometric/passkey authentication is an advanced capability in NexTrace. "
                       "No WebAuthn relying party is configured in this environment, so no "
                       "challenge could be issued. Sign in with your Analyst ID and password."),
        }

    def verify_authentication(self, analyst_id: str, credential_response: dict) -> bool:
        return False


# Registry so a real relying party can be registered later without touching call sites.
WEB_AUTHN_REGISTRY = {
    "default": UnavailableWebAuthnBackend(),
}


def get_webauthn_backend() -> WebAuthnAuthBackend:
    return WEB_AUTHN_REGISTRY["default"]
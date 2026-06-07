#!/usr/bin/env python3
"""Convert Spotify OAuth tokens to librespot stored credentials for zotify."""
import json
import sys
import time

from librespot.core import Session
from librespot.oauth import OAuth


def main():
    if len(sys.argv) != 6:
        print(
            "usage: credentials-bridge.py <client_id> <access_token> <refresh_token> "
            "<expires_in> <output_path>",
            file=sys.stderr,
        )
        sys.exit(2)

    client_id, access_token, refresh_token, expires_in, output_path = sys.argv[1:6]
    oauth = OAuth(client_id, "http://127.0.0.1:1/callback", None)
    oauth.ingest_token_response({
        "access_token": access_token,
        "refresh_token": refresh_token,
        "expires_in": int(expires_in),
    })

    last_err = None
    for attempt in range(5):
        session = None
        try:
            conf = (
                Session.Configuration.Builder()
                .set_stored_credential_file(output_path)
                .set_store_credentials(True)
                .build()
            )
            builder = Session.Builder(conf)
            builder.login_credentials = oauth.get_credentials()
            session = builder.create()
            username = session.username()
            print(json.dumps({"ok": True, "username": username, "path": output_path}))
            return
        except Exception as err:
            last_err = err
            if session is not None:
                try:
                    session.close()
                except Exception:
                    pass
            if attempt < 4:
                time.sleep(1.5 * (attempt + 1))
        finally:
            if session is not None:
                try:
                    session.close()
                except Exception:
                    pass

    raise last_err


if __name__ == "__main__":
    try:
        main()
    except Exception as err:
        print(str(err), file=sys.stderr)
        sys.exit(1)

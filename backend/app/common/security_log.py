import logging

logger = logging.getLogger("listify.security")


def security_event(event: str, **fields: object) -> None:
    """One searchable log line per security event (S-17).

    Never pass passwords or tokens, and never the text typed into the email box on a failed
    sign-in: people sometimes type their password there by mistake.
    """
    logger.info(event, extra={"extra_fields": {"event": event, **fields}})

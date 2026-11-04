import logging
wxlog = logging.getLogger("jla.wechat.readonly")
wxlog.addHandler(logging.NullHandler())
wxlog.propagate = False

import os, sys
from pyftpdlib.authorizers import DummyAuthorizer
from pyftpdlib.handlers import FTPHandler
from pyftpdlib.servers import FTPServer
authorizer = DummyAuthorizer()
authorizer.add_user('fixture', 'temporary-ftp-test-password', sys.argv[1], perm='elradfmwMT')
FTPHandler.authorizer = authorizer
FTPHandler.banner = 'Disposable loopback test server'
FTPServer(('127.0.0.1', int(sys.argv[2])), FTPHandler).serve_forever()

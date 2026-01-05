#!/bin/bash
export PATH="/mnt/c/Program Files/nodejs:$PWD/bin:$PATH"
export NODE_ENV=development
chmod +x bin/yarn
yarn start

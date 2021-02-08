FROM node:14

COPY package.json ./
COPY yarn.lock ./

RUN yarn --prod

# Bundle app source
COPY . .

CMD [ "./node_modules/.bin/micro" ]

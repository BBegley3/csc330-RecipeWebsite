## For Initial Startup

- Create a file called ".env" in the same directory as "compose.yml"

## Paste the following into the .env:
POSTGRES_PASSWORD=replace_me
CLERK_PUBLISHABLE_KEY=replace_me
CLERK_SECRET_KEY=replace_me

## Get a Clerk Publishable Key and Clerk Secret Key
https://clerk.com/
(or from Bryan)

## Download and Install Docker
https://www.docker.com/products/docker-desktop/

## Make Sure Docker is running and Open a Terminal in the same directory as "compose.yml"
## Run the following command
docker compose up --build -d

## Navigate to one of the following URLs to test
http://localhost:8080/api/health 
http://localhost:8080/api/recipes
http://localhost:8080/api/recipes/1

## For troubleshooting and checking on containers:
docker ps
docker compose logs -f backend db nginx

## To shut down use the following command
docker compose down
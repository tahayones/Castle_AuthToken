FROM mcr.microsoft.com/dotnet/sdk:8.0 AS build
WORKDIR /src
COPY CastleApi/CastleApi.csproj CastleApi/
RUN dotnet restore CastleApi/CastleApi.csproj
COPY CastleApi/ CastleApi/
RUN dotnet publish CastleApi/CastleApi.csproj -c Release -o /app/publish

FROM mcr.microsoft.com/dotnet/aspnet:8.0 AS final
WORKDIR /app

RUN apt-get update && apt-get install -y --no-install-recommends \
    curl \
    ca-certificates \
    gnupg \
    python3 \
    python3-pip \
    python3-venv \
    && curl -fsSL https://deb.nodesource.com/setup_22.x | bash - \
    && apt-get install -y nodejs \
    && rm -rf /var/lib/apt/lists/*

RUN python3 -m pip install --no-cache-dir --break-system-packages curl_cffi pyotp

COPY --from=build /app/publish .

COPY package.json package-lock.json ./
RUN npm install --omit=dev

COPY castle_engine_final.js castle_cdn_sdk.js auth_token.py single_account_runner.py ./
RUN touch proxy.txt accounts.txt

ENV ASPNETCORE_URLS=http://+:8000
ENV PORT=8000
ENV Scripts__ScriptsDirectory=/app
ENV Scripts__NodeExecutable=node
ENV Scripts__PythonExecutable=python3

EXPOSE 8000

ENTRYPOINT ["dotnet", "CastleApi.dll"]

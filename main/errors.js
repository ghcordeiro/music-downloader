function randomReference() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let out = '';
  for (let i = 0; i < 6; i++) out += chars[Math.floor(Math.random() * chars.length)];
  return out;
}

class AppError extends Error {
  constructor(message, code, userMessage) {
    super(message);
    this.code = code;
    this.userMessage = userMessage;
  }
}

class InvalidUrlError extends AppError {
  constructor(url) {
    super(`invalid url: ${url}`, 'INVALID_URL', 'Esse link não parece ser válido.');
    this.url = url;
  }
}

class SpotifyAuthError extends AppError {
  constructor(detail) {
    super(`Spotify auth failed: ${detail}`, 'SPOTIFY_AUTH',
      'Não consegui falar com o Spotify. As credenciais embutidas podem estar inválidas.');
  }
}

class PlaylistNotFoundError extends AppError {
  constructor(url) {
    super(`playlist not found: ${url}`, 'PLAYLIST_NOT_FOUND',
      'Não encontrei essa playlist. Confira se o link está correto e se a playlist é pública.');
    this.url = url;
  }
}

class NetworkError extends AppError {
  constructor(detail) {
    super(`network error: ${detail}`, 'NETWORK',
      'Sem conexão com a internet. Verifique sua rede e tente de novo.');
  }
}

class BinaryMissingError extends AppError {
  constructor(name) {
    super(`binary missing: ${name}`, 'BINARY_MISSING',
      'Um componente do app está faltando. Reinstale e tente novamente.');
    this.binary = name;
  }
}

class DiskFullError extends AppError {
  constructor() {
    super('disk full', 'DISK_FULL',
      'Espaço em disco insuficiente. Libere espaço e tente novamente.');
  }
}

class OutputFolderUnwritableError extends AppError {
  constructor(folder) {
    super(`output folder unwritable: ${folder}`, 'OUTPUT_UNWRITABLE',
      `Não consigo escrever em ${folder}, escolha outra pasta.`);
    this.folder = folder;
  }
}

class NoInternetError extends AppError {
  constructor(detail) {
    super(`no internet: ${detail}`, 'NO_INTERNET',
      'Sem internet, verifique sua conexão.');
  }
}

class UnexpectedError extends AppError {
  constructor(cause) {
    super(`unexpected error: ${cause?.message || cause}`, 'UNEXPECTED',
      'Erro inesperado. Anote o código abaixo e mande pra quem te passou o app.');
    this.cause = cause;
    this.reference = randomReference();
  }
}

module.exports = {
  AppError,
  InvalidUrlError,
  SpotifyAuthError,
  PlaylistNotFoundError,
  NetworkError,
  BinaryMissingError,
  DiskFullError,
  OutputFolderUnwritableError,
  NoInternetError,
  UnexpectedError,
};

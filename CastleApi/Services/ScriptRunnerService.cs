using System.Diagnostics;
using System.Text.Json;
using CastleApi.Models;

namespace CastleApi.Services;

public class ScriptRunnerService : IScriptRunnerService
{
    private readonly IConfiguration _config;
    private readonly ILogger<ScriptRunnerService> _logger;
    private readonly string _baseDir;
    private readonly string _nodeExe;
    private readonly string _pythonExe;

    public ScriptRunnerService(IConfiguration config, ILogger<ScriptRunnerService> logger)
    {
        _config = config;
        _logger = logger;

        var configuredBase = _config["Scripts:ScriptsDirectory"];
        if (!string.IsNullOrWhiteSpace(configuredBase) && Directory.Exists(configuredBase))
        {
            _baseDir = Path.GetFullPath(configuredBase);
        }
        else if (File.Exists(Path.Combine(AppContext.BaseDirectory, "castle_engine_final.js")))
        {
            _baseDir = AppContext.BaseDirectory;
        }
        else
        {
            _baseDir = Path.GetFullPath(Path.Combine(AppContext.BaseDirectory, "..", "..", "..", ".."));
        }

        var configuredNode = _config["Scripts:NodeExecutable"];
        if (!string.IsNullOrWhiteSpace(configuredNode) && (File.Exists(configuredNode) || configuredNode == "node"))
        {
            _nodeExe = configuredNode;
        }
        else
        {
            var nvmNode = @"C:\Users\tyone\AppData\Local\nvm\v22.22.3\node.exe";
            _nodeExe = File.Exists(nvmNode) ? nvmNode : "node";
        }

        var configuredPython = _config["Scripts:PythonExecutable"];
        if (!string.IsNullOrWhiteSpace(configuredPython) && (File.Exists(configuredPython) || configuredPython == "python" || configuredPython == "python3"))
        {
            _pythonExe = configuredPython;
        }
        else
        {
            var py313 = @"C:\Users\tyone\AppData\Local\Programs\Python\Python313\python.exe";
            _pythonExe = File.Exists(py313) ? py313 : (Environment.OSVersion.Platform == PlatformID.Unix ? "python3" : "python");
        }
    }

    public async Task<CastleTokenResponse> GenerateCastleTokenAsync(CastleTokenRequest request, CancellationToken cancellationToken = default)
    {
        var sw = Stopwatch.StartNew();
        var response = new CastleTokenResponse();

        var scriptPath = Path.Combine(_baseDir, "castle_engine_final.js");
        if (!File.Exists(scriptPath))
        {
            response.Success = false;
            response.ErrorMessage = $"Castle script not found at {scriptPath}";
            return response;
        }

        var count = Math.Max(1, request.Count);
        var threads = Math.Max(1, request.Threads);

        var argsList = new List<string>
        {
            $"\"{scriptPath}\"",
            count.ToString(),
            $"--threads={threads}",
            "--stdout"
        };

        if (!string.IsNullOrWhiteSpace(request.ProxyIp))
        {
            argsList.Add($"--ip={request.ProxyIp.Trim()}");
        }

        var arguments = string.Join(" ", argsList);

        try
        {
            var (exitCode, stdout, stderr) = await RunProcessAsync(_nodeExe, arguments, _baseDir, TimeSpan.FromSeconds(60), cancellationToken);
            sw.Stop();
            response.ExecutionTimeMs = sw.ElapsedMilliseconds;

            var lines = stdout.Split(new[] { '\r', '\n' }, StringSplitOptions.RemoveEmptyEntries)
                              .Select(l => l.Trim())
                              .Where(l => l.Length > 20)
                              .ToList();

            if (exitCode == 0 && lines.Count > 0)
            {
                response.Success = true;
                response.Token = lines[0];
                response.Tokens = lines;
            }
            else
            {
                response.Success = false;
                response.ErrorMessage = !string.IsNullOrWhiteSpace(stderr) ? stderr : "Failed to retrieve Castle token";
            }
        }
        catch (Exception ex)
        {
            sw.Stop();
            response.Success = false;
            response.ExecutionTimeMs = sw.ElapsedMilliseconds;
            response.ErrorMessage = ex.Message;
        }

        return response;
    }

    public async Task<TwitterAuthResponse> ExecuteTwitterAuthAsync(TwitterAuthRequest request, CancellationToken cancellationToken = default)
    {
        var sw = Stopwatch.StartNew();
        var response = new TwitterAuthResponse();

        var scriptPath = Path.Combine(_baseDir, "single_account_runner.py");
        if (!File.Exists(scriptPath))
        {
            response.Success = false;
            response.ErrorMessage = $"Runner script not found at {scriptPath}";
            return response;
        }

        var argsList = new List<string>
        {
            $"\"{scriptPath}\"",
            $"--username \"{request.Username.Replace("\"", "\\\"")}\"",
            $"--password \"{request.Password.Replace("\"", "\\\"")}\""
        };

        if (!string.IsNullOrWhiteSpace(request.TotpSecret))
        {
            argsList.Add($"--totp \"{request.TotpSecret.Trim().Replace("\"", "\\\"")}\"");
        }

        if (!string.IsNullOrWhiteSpace(request.Proxy))
        {
            argsList.Add($"--proxy \"{request.Proxy.Trim().Replace("\"", "\\\"")}\"");
        }

        var arguments = string.Join(" ", argsList);

        try
        {
            var (exitCode, stdout, stderr) = await RunProcessAsync(_pythonExe, arguments, _baseDir, TimeSpan.FromMinutes(2), cancellationToken);
            sw.Stop();
            response.ExecutionTimeMs = sw.ElapsedMilliseconds;

            var marker = "__RESULT_JSON__:";
            var markerIndex = stdout.LastIndexOf(marker, StringComparison.Ordinal);
            if (markerIndex >= 0)
            {
                var jsonStr = stdout[(markerIndex + marker.Length)..].Trim();
                using var doc = JsonDocument.Parse(jsonStr);
                var root = doc.RootElement;

                var success = root.GetProperty("success").GetBoolean();
                response.Success = success;
                response.AuthToken = root.TryGetProperty("auth_token", out var pAuth) ? pAuth.GetString() : null;
                response.Ct0 = root.TryGetProperty("ct0", out var pCt0) ? pCt0.GetString() : null;
                response.Twid = root.TryGetProperty("twid", out var pTwid) ? pTwid.GetString() : null;
                response.ErrorMessage = root.TryGetProperty("error", out var pErr) ? pErr.GetString() : null;
            }
            else
            {
                response.Success = false;
                response.ErrorMessage = !string.IsNullOrWhiteSpace(stderr) ? stderr : stdout;
            }
        }
        catch (Exception ex)
        {
            sw.Stop();
            response.Success = false;
            response.ExecutionTimeMs = sw.ElapsedMilliseconds;
            response.ErrorMessage = ex.Message;
        }

        return response;
    }

    private static async Task<(int ExitCode, string Stdout, string Stderr)> RunProcessAsync(
        string fileName,
        string arguments,
        string workingDirectory,
        TimeSpan timeout,
        CancellationToken cancellationToken)
    {
        using var process = new Process
        {
            StartInfo = new ProcessStartInfo
            {
                FileName = fileName,
                Arguments = arguments,
                WorkingDirectory = workingDirectory,
                RedirectStandardOutput = true,
                RedirectStandardError = true,
                UseShellExecute = false,
                CreateNoWindow = true
            }
        };

        process.Start();

        var stdoutTask = process.StandardOutput.ReadToEndAsync(cancellationToken);
        var stderrTask = process.StandardError.ReadToEndAsync(cancellationToken);

        using var cts = CancellationTokenSource.CreateLinkedTokenSource(cancellationToken);
        cts.CancelAfter(timeout);

        try
        {
            await process.WaitForExitAsync(cts.Token);
            var stdout = await stdoutTask;
            var stderr = await stderrTask;
            return (process.ExitCode, stdout, stderr);
        }
        catch (OperationCanceledException)
        {
            try
            {
                if (!process.HasExited)
                {
                    process.Kill(entireProcessTree: true);
                }
            }
            catch
            {
            }
            throw new TimeoutException($"Process '{fileName}' timed out after {timeout.TotalSeconds} seconds.");
        }
    }
}

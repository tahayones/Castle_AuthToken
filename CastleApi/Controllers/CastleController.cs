using CastleApi.Models;
using CastleApi.Services;
using Microsoft.AspNetCore.Mvc;

namespace CastleApi.Controllers;

[ApiController]
[Route("api/[controller]")]
public class CastleController : ControllerBase
{
    private readonly IScriptRunnerService _scriptRunner;

    public CastleController(IScriptRunnerService scriptRunner)
    {
        _scriptRunner = scriptRunner;
    }

    [HttpPost("generate-token")]
    [ProducesResponseType(typeof(CastleTokenResponse), StatusCodes.Status200OK)]
    [ProducesResponseType(typeof(CastleTokenResponse), StatusCodes.Status400BadRequest)]
    public async Task<IActionResult> GenerateToken([FromBody] CastleTokenRequest request, CancellationToken cancellationToken)
    {
        var result = await _scriptRunner.GenerateCastleTokenAsync(request, cancellationToken);
        if (!result.Success)
        {
            return BadRequest(result);
        }
        return Ok(result);
    }
}

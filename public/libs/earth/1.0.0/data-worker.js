/**
 * data-worker - Web Worker for handling data parsing and interpolation calculations
 *
 * Copyright (c) 2014 Cameron Beccario
 * The MIT License - http://opensource.org/licenses/MIT
 *
 * https://github.com/cambecc/earth
 */

(function() {
    "use strict";

    var τ = 2 * Math.PI;

    function isValue(x) {
        return x !== null && x !== undefined;
    }

    function floorMod(a, n) {
        var f = a - n * Math.floor(a / n);
        return f === n ? 0 : f;
    }

    function bilinearInterpolateScalar(x, y, g00, g10, g01, g11) {
        var rx = (1 - x);
        var ry = (1 - y);
        return g00 * rx * ry + g10 * x * ry + g01 * rx * y + g11 * x * y;
    }

    function bilinearInterpolateVector(x, y, g00, g10, g01, g11) {
        var rx = (1 - x);
        var ry = (1 - y);
        var a = rx * ry,  b = x * ry,  c = rx * y,  d = x * y;
        var u = g00[0] * a + g10[0] * b + g01[0] * c + g11[0] * d;
        var v = g00[1] * a + g10[1] * b + g01[1] * c + g11[1] * d;
        return [u, v, Math.sqrt(u * u + v * v)];
    }

    function buildGrid(builder) {
        var header = builder.header;
        var λ0 = header.lo1, φ0 = header.la1;
        var Δλ = header.dx, Δφ = header.dy;
        var ni = header.nx, nj = header.ny;
        var date = new Date(header.refTime);
        date.setHours(date.getHours() + header.forecastTime);

        var gridData = new Float32Array(ni * nj * 2);
        var isContinuous = Math.floor(ni * Δλ) >= 360;
        var p = 0;

        for (var j = 0; j < nj; j++) {
            for (var i = 0; i < ni; i++, p++) {
                var value = builder.data(p);
                if (Array.isArray(value)) {
                    gridData[p * 2] = value[0];
                    gridData[p * 2 + 1] = value[1];
                } else {
                    gridData[p * 2] = value;
                    gridData[p * 2 + 1] = 0;
                }
            }
        }

        return {
            header: header,
            gridData: gridData,
            ni: ni,
            nj: nj,
            λ0: λ0,
            φ0: φ0,
            Δλ: Δλ,
            Δφ: Δφ,
            isContinuous: isContinuous,
            date: date.getTime(),
            interpolateType: builder.interpolateType
        };
    }

    function interpolateGrid(grid, λ, φ) {
        var i = floorMod(λ - grid.λ0, 360) / grid.Δλ;
        var j = (grid.φ0 - φ) / grid.Δφ;

        var fi = Math.floor(i), ci = fi + 1;
        var fj = Math.floor(j), cj = fj + 1;

        var ni = grid.ni;
        var nj = grid.nj;

        if (fi < 0 || fi >= ni || fj < 0 || fj >= nj) {
            return null;
        }

        var gridData = grid.gridData;
        var g00, g10, g01, g11;

        if (grid.interpolateType === 'vector') {
            g00 = [gridData[fj * ni * 2 + fi * 2], gridData[fj * ni * 2 + fi * 2 + 1]];
            g10 = [gridData[fj * ni * 2 + ci * 2], gridData[fj * ni * 2 + ci * 2 + 1]];
            g01 = [gridData[cj * ni * 2 + fi * 2], gridData[cj * ni * 2 + fi * 2 + 1]];
            g11 = [gridData[cj * ni * 2 + ci * 2], gridData[cj * ni * 2 + ci * 2 + 1]];

            if (!isValue(g00[0]) || !isValue(g10[0]) || !isValue(g01[0]) || !isValue(g11[0])) {
                return null;
            }

            return bilinearInterpolateVector(i - fi, j - fj, g00, g10, g01, g11);
        } else {
            g00 = gridData[fj * ni * 2 + fi * 2];
            g10 = gridData[fj * ni * 2 + ci * 2];
            g01 = gridData[cj * ni * 2 + fi * 2];
            g11 = gridData[cj * ni * 2 + ci * 2];

            if (!isValue(g00) || !isValue(g10) || !isValue(g01) || !isValue(g11)) {
                return null;
            }

            return bilinearInterpolateScalar(i - fi, j - fj, g00, g10, g01, g11);
        }
    }

    self.onmessage = function(e) {
        var message = e.data;
        var type = message.type;
        var callbackId = message.callbackId;

        try {
            switch (type) {
                case 'buildGrid':
                    var builder = message.builder;
                    var result = buildGrid(builder);
                    self.postMessage({
                        type: 'buildGridResult',
                        callbackId: callbackId,
                        result: result
                    });
                    break;

                case 'interpolate':
                    var grid = message.grid;
                    var λ = message.lambda;
                    var φ = message.phi;
                    var interpolateResult = interpolateGrid(grid, λ, φ);
                    self.postMessage({
                        type: 'interpolateResult',
                        callbackId: callbackId,
                        result: interpolateResult
                    });
                    break;

                default:
                    self.postMessage({
                        type: 'error',
                        callbackId: callbackId,
                        message: 'Unknown message type: ' + type
                    });
            }
        } catch (error) {
            self.postMessage({
                type: 'error',
                callbackId: callbackId,
                message: error.message
            });
        }
    };
})();

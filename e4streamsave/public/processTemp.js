//To use:
//<script src="processTemp.js" type="text/javascript">
//
//processTemp.noseTemp(rawval, rawthermistor);
//processTemp.templeTemp(rawval, rawthermistor);
//
//
var processTemp = (function() {
  var _processTemp = {};


  function thermistorToK(raw_value) {
    // STEP 1. Calc R_thermistor value given ADC_val
    var R_divider = 100000;
    var ADC_max = 4095;

    var R_t = (R_divider * raw_value/ADC_max) / (1 - raw_value/ADC_max);

    // STEP 2. Convert R_t to temp
    var R_0 = 100000;
    var T_0 = 298.15;
    var Beta = 3960;
    var R_inf = R_0 * Math.exp(-Beta/T_0);

    var Temp_K = Beta / Math.log(R_t / R_inf);
    return Temp_K;
  }

  function thermopileToC(raw_val, T_ref_K, A, a_0, a_1) {
    //STEP 1. Calc V_thermopile based on preamp gain and bias
    var V_tp = (((raw_val / 4095) * 3.3) - (1.15+0.6084))/1000.0;

    //STEP 2. Solve for Temperature!
    var f_V_tp = (V_tp - a_0) + a_1 * (V_tp - a_0)**2;
    var T_obj = (T_ref_K**4 + f_V_tp/A)**0.25;
    return (T_obj - 273.15);
  }


  _processTemp.noseTemp = function(raw_val, raw_thermistor) {
    var A   =  7.8e-10;
    var a_0 = -2.31e-01;
    var a_1 =  3.61e-03;
    return thermopileToC(raw_val,
                         thermistorToK(raw_thermistor),
                         A, a_0, a_1);
  };

  _processTemp.templeTemp = function(raw_val, raw_thermistor) {
    var A   =  4.21e-10;
    var a_0 = -3.62e-01;
    var a_1 =  8.31e-02;
    return thermopileToC(raw_val,
                         thermistorToK(raw_thermistor),
                         A, a_0, a_1);
  };

  return _processTemp;

})();



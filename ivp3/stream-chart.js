function streamgraphChart() {
    var margin = {top: 0, right: 0, bottom: 0, left: 0},
       	width = 960,
    	height = 500,
    	outerRadius = height / 2 - 10,
    	innerRadius = 120,
    	padding=20,
        transitionDuration = 1000,
        color = function() { return d3.interpolateRgb("#aad", "#556")(Math.random()); };
 
    var streamgraph =  d3.layout.stack().offset("wiggle");

    
    
    function chart(selection) {
        selection.each(function(data) {
 
            // Compute the streamgraph.
            data = streamgraph(data);
            var mx = data[0].length - 1, // assumes that all layers have same # of samples & that there is at least one layer
                my = d3.max(data, function(d) {
                    return d3.max(d, function(d) {
                        return d.y0 + d.y;
                    });
                });
 
 
            // Select the svg element, if it exists.
            var svg = d3.select(this).selectAll("svg").data([data]);
 
            // Otherwise, create the skeletal chart.
            var gEnter = svg.enter().append("svg").append("g");
 
            // Update the outer dimensions.
            svg .attr("width", width)
                .attr("height", height);
 
            // Update the inner dimensions.
            var g = svg.select("g")
            	.attr("transform", "translate(200,200) scale(.33)");
            	//.attr("transform", "translate(" + width/(2) + "," + height/(2)  + ")");
                //.attr("transform", "translate(" + margin.left + "," + margin.top + ")");
 
            // Update the streamgraph
            var availableWidth = width - margin.left - margin.right,
                availableHeight = height - margin.top - margin.bottom;
 
            var area = d3.svg.area.radial()
            	.interpolate("cardinal-closed")
                .angle(function(d) { return d.x;})
                .innerRadius(function(d) { return availableHeight - d.y0 * availableHeight / my; })
                .outerRadius(function(d) { return availableHeight - (d.y + d.y0) * availableHeight / my; });
 
            var path = g.selectAll("path").data(data);
 
            path.enter().append("path");
 			path.exit().remove();
 			
			 //Draw the Ellipse
			var circle = svg.selectAll("circle")
				.data([300], function(d) { return d; });

			circle.enter().append("circle")
    			.attr("cy", 200)
    			.attr("cx", 200)
    			.attr("r", 50)
    			.style("fill","gray");
				circle.exit().remove();      
				             
            
            path.style("fill", color).transition().duration(transitionDuration).attr("d", area);
        });
    }
 
    chart.color = function(_) {
        if (!arguments.length) return color;
        color = _;
        return chart;
    };
 
    chart.transitionDuration = function(_) {
        if (!arguments.length) return transitionDuration;
        transitionDuration = _;
        return chart;
    };
 
    chart.margin = function(_) {
        if (!arguments.length) return margin;
        margin = _;
        return chart;
    };
 
    chart.width = function(_) {
        if (!arguments.length) return width;
        width = _;
        return chart;
    };
 
    chart.height = function(_) {
        if (!arguments.length) return height;
        height = _;
        return chart;
    };
 
    return chart;
}
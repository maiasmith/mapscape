HTMLWidgets.widget({

    name: 'spacesweep',

    type: 'output',

    initialize: function(el, width, height) {

        // defaults
        var defaults = {
            smallMargin: 5,
            widgetMargin: 10, // marging between widgets
            rootColour: '#717171',
            pureColour: '#D3D2D2',
            anatomicLineColour: '#444444',
            legendWidth: 130,
            legendTitleHeight: 16,
            mixtureClassFontSize: 13,
            max_r: 8, // maximum radius for tree nodes
            sampleMark_r: 5, // sample mark radius
            dragOn: false, // whether or not drag is on
            selectOn: false, // whether or not link selection is on
            mutSelectOn: false, // whether or not the mutation selection is on
            startLocation: Math.PI/2, // starting location [0, 2*Math.PI] of sample ordering
            legendSpacing: 15, // spacing between legend items
            shadeAlpha: 0.08, // alpha value for shading
            neutralGrey: "#9E9A9A", // grey used for font colour, anatomic lines, etc.
            legendTitleColour: "#000000", // colour used for legend titles
            nClickedNodes: 0, // number of clicked nodes
            curCloneIDs: [], // array of clone ids currently in the mutation table
            phantomRoot: "phantomRoot"
        };

        // set configurations
        var config = $.extend(true, {}, defaults);
        config.containerWidth = width;
        config.containerHeight = height;

        // global variable vizObj
        vizObj = {};
        var view_id = el.id;
        vizObj[view_id] = {};
        vizObj[view_id].data = {};
        vizObj[view_id].view = {};
        vizObj[view_id].generalConfig = config;

        return {}

    },

    renderValue: function(el, x, instance) {

        // vizObj for the current view
        var view_id = el.id;
        var curVizObj = vizObj[view_id]; 
        curVizObj.view_id = view_id;
        var dim = curVizObj.generalConfig;

        // get params from R
        curVizObj.userConfig = x;

        // SET CONFIGURATIONS FOR THIS VIEW

        // image for use 
        dim.image_ref = "data:image/png;base64," + curVizObj.userConfig.img_ref;

        // mutation table layout
        dim.mutationTableHeight = 300;

        // main view layout
        dim.viewDiameter = ((dim.containerWidth-dim.legendWidth) < (dim.containerHeight-dim.mutationTableHeight)) ? 
            (dim.containerWidth-dim.legendWidth) :
            (dim.containerHeight-dim.mutationTableHeight); 
        dim.mutationTableWidth = dim.viewDiameter + dim.legendWidth;
        dim.viewCentre = { x: dim.viewDiameter/2, y: dim.viewDiameter/2 };
        dim.outerRadius = dim.viewDiameter/2; 
        dim.innerRadius = dim.viewDiameter/6; // radius for centre circle (where anatomy will go)
        dim.circBorderWidth = 3; // width for circular border width
        
        // - 8, - 20, - 3 for extra space
        dim.oncoMixWidth = ((dim.outerRadius - dim.circBorderWidth - dim.innerRadius)/2) - 8; 
        dim.treeWidth = ((dim.outerRadius - dim.circBorderWidth - dim.innerRadius)/2) - 20; 
        dim.radiusToOncoMix = dim.innerRadius + dim.oncoMixWidth/2 - 3; // radius to oncoMix centre
        dim.radiusToTree = dim.innerRadius + dim.oncoMixWidth + dim.treeWidth/2 + 10; // radius to tree centre

        // legend layout
        dim.legendHeight = dim.viewDiameter;
        dim.legendTreeWidth = dim.legendWidth - 2; // width of the tree in the legend
        dim.legend_image_plot_diameter = dim.legendWidth; // width of the plot space for the image
        dim.legend_image_top_l = {x: 0, y: dim.legendTreeWidth + dim.legendTitleHeight*2 + dim.legendSpacing};

        // anatomical image configurations
        dim.image_plot_diameter = dim.innerRadius*2; // width of the plot space for the image
        dim.image_top_l = {x: dim.viewDiameter/2 - dim.image_plot_diameter/2, 
                                y: dim.viewDiameter/2 - dim.image_plot_diameter/2};

        // get image width & height (in pixels)
        curVizObj.imgDimDeferred = new $.Deferred();
        _getImageDimensions(curVizObj, dim.image_ref);

        // when image dimensions acquired...
        $.when(curVizObj.imgDimDeferred.promise()).then(function() {

            // get legend image dimensions
            dim.legend_image_width = dim.legend_image_plot_diameter;
            dim.legend_image_height = dim.legend_image_width/curVizObj.view.aspect_ratio;

            // legend mixture classification configurations
            dim.legend_mixture_top = dim.legend_image_top_l.y + dim.legend_image_height + dim.legendSpacing;

            // map each sample to its anatomic location (including coordinates)
            _mapSamplesToAnatomy(curVizObj);

            // get participating anatomic locations in this view
            _getParticipatingAnatomicLocations(curVizObj);

            // get image bounds for current sample data 
            _getImageBounds(curVizObj);


            // GET CONTENT

            // extract all info from tree about nodes, edges, ancestors, descendants
            _getTreeInfo(curVizObj);

            // get phylogenetic colours
            _getPhyloColours(curVizObj);

            // sample ids
            curVizObj.data.sample_ids = (curVizObj.userConfig.sample_ids == "NA") ? 
                _.uniq(_.pluck(curVizObj.userConfig.clonal_prev, "sample_id")):
                curVizObj.userConfig.sample_ids;


            // if no sample ordering is given by the user
            if (curVizObj.userConfig.sample_ids == "NA") {
                // initial ordering of samples based on their anatomic location
                _initialSiteOrdering(curVizObj);
            }

            // get cellular prevalence data in workable format, and threshold it
            _getCPData(curVizObj);
            _thresholdCPData(curVizObj)

            // get sample positioning
            _getSamplePositioning(curVizObj); // position elements for each sample

            // get samples showing each genotype
            _getGenotypeSites(curVizObj);

            // get samples affected by each link (identified here by its target clone)
            _getSitesAffectedByLink(curVizObj);

            // get mutation data in better format
            if (curVizObj.userConfig.mutations[0] != "NA") {
                _reformatMutations(curVizObj);

                // get column names (depending on the available data, which columns will be shown)
                dim.mutationColumns = [
                                { "data": "chrom", "title": "Chromosome" },
                                { "data": "coord", "title": "Coordinate" },
                                { "data": "empty", "title": "Clone", "bSortable": false }
                            ];
                if (curVizObj.userConfig.mutations[0].hasOwnProperty("gene_name")) {
                    dim.mutationColumns.push({ "data": "gene_name", "title": "Gene Name" });
                }
                if (curVizObj.userConfig.mutations[0].hasOwnProperty("effect")) {
                    dim.mutationColumns.push({ "data": "effect", "title": "Effect" });
                }
                if (curVizObj.userConfig.mutations[0].hasOwnProperty("impact")) {
                    dim.mutationColumns.push({ "data": "impact", "title": "Impact" });
                }

                
            }

            console.log("curVizObj");
            console.log(curVizObj);

            // VIEW SETUP

            // radii (- 8, - 6 = how much space to give between nodes)
            var tree_height = curVizObj.data.tree_height, // height of the tree (# nodes)
                node_r = ((dim.treeWidth - 6*tree_height)/tree_height)/2, // sample tree
                legendNode_r = ((dim.legendTreeWidth - 8*tree_height)/tree_height)/2; // legend tree

            // make sure radii do not surpass the maximum
            dim.node_r = (node_r > dim.max_r) ? dim.max_r : node_r;
            dim.legendNode_r = (legendNode_r > dim.max_r) ? dim.max_r : legendNode_r;

            // DRAG BEHAVIOUR

            var drag = d3.behavior.drag()
                .on("dragstart", function(d) {
                    dim.dragOn = true; 

                    // calculate angle w/the positive x-axis, formed by the line segment between the mouse & view centre
                    var voronoiCentre = d3.select("#" + view_id).select(".anatomicPointer.sample_"+d.sample); 
                    curVizObj.view.startAngle = _find_angle_of_line_segment(
                        {x: voronoiCentre.attr("x1"), y: voronoiCentre.attr("y1")},
                        {x: dim.viewCentre.x, y: dim.viewCentre.y});
                })
                .on("drag", function(d,i) {

                    // operations on drag
                    _dragFunction(curVizObj, d.sample, d);
                })
                .on("dragend", function(d) {
                    dim.dragOn = false; 

                    // calculate angle w/the positive x-axis, formed by the line segment between the mouse & view centre
                    var voronoiCentre = d3.select("#" + view_id).select(".anatomicPointer.sample_"+d.sample); 
                    curVizObj.view.endAngle = _find_angle_of_line_segment(
                        {x: voronoiCentre.attr("x1"), y: voronoiCentre.attr("y1")},
                        {x: dim.viewCentre.x, y: dim.viewCentre.y});

                    // order samples
                    _reorderSitesData(curVizObj);

                    // get sample positioning coordinates etc
                    _getSamplePositioning(curVizObj);   

                    // reposition samples on the screen
                    _snapSites(curVizObj);
                });

            // DIVS

            var buttonDIV = d3.select(el).append("div")
                .append("button")
                .attr("type","button")
                .attr("class", "downloadButton")
                .text("Download SVG")
                .on("click", function() {
                    // download the svg
                    downloadSVG("spacesweep_" + view_id);
                });

            var buttonDIV = d3.select(el).append("div")
                .append("button")
                .attr("type","button")
                .attr("class", "downloadPNGButton")
                .attr("id", "downloadPNGButton")
                .text("Download PNG")
                .on("click", function(){
                    // download the png
                    _downloadPNG("spacesweep_" + view_id, "spacesweep_" + view_id + ".png");
                });

            var canvasDIV = d3.select(el)
                .append("div")
                .attr("class", "canvasDIV")
                .style("position", "relative")
                .style("width", (dim.viewDiameter + dim.legendWidth) + "px")
                .style("height", (dim.viewDiameter) + "px")
                .style("float", "left");

            curVizObj.view.mutationTableDIV = d3.select(el)
                .append("div")
                .attr("class", "mutationTableDIV")
                .style("position", "relative")
                .style("width", dim.mutationTableWidth + "px")
                .style("height", dim.mutationTableHeight + "px")
                .style("float", "left");

            // canvas for image png output
            var canvas = d3.select(el).append("canvas")
                .attr("height", (dim.viewDiameter) + "px")
                .attr("width", (dim.viewDiameter + dim.legendWidth) + "px")
                .attr("style", "display:none");

            // SVGS

            var viewSVG = canvasDIV.append("svg:svg")
                .attr("class", "spacesweep_" + view_id)
                .attr("x", 0)
                .attr("y", 0)
                .attr("width", (dim.viewDiameter + dim.legendWidth) + "px")
                .attr("height", dim.viewDiameter + "px")
                .on("click", function() {
                     _backgroundClick(curVizObj);
                });

            // PLOT ANATOMY IMAGE IN MAIN VIEW

            var defs = viewSVG.append("defs").attr("id", "imgdefs")

            var anatomyPattern = defs.append("pattern")
                                    .attr("id", "anatomyPattern")
                                    .attr("height", 1)
                                    .attr("width", 1)

            anatomyPattern.append("image")
                .attr("class", "anatomyImage")
                .attr("x", 0)
                .attr("y", 0)
                .attr("height", dim.image_plot_diameter)
                .attr("width", dim.image_plot_diameter)
                .attr("xlink:href", dim.image_ref);

            viewSVG.append("circle")
                .attr("class", "anatomyDiagram")
                .attr("r", dim.innerRadius)
                .attr("cy", dim.viewDiameter/2)
                .attr("cx", dim.viewDiameter/2)
                .attr("fill", "url(#anatomyPattern)")
                .attr("stroke", "#CBCBCB")
                .attr("stroke-width", "3px")
                .attr("stroke-opacity", 0.2);

            // ZOOM INTO SELECT REGION ON ANATOMICAL IMAGE

            // get scaling information
            curVizObj.view.crop_info = _scale(curVizObj);

            // update the anatomy image with the new cropping
            d3.select("#" + view_id).select(".anatomyImage") 
                .attr("height", curVizObj.view.crop_info.scaled_image_height)
                .attr("width", curVizObj.view.crop_info.scaled_image_width)
                .attr("x", -curVizObj.view.crop_info.left_shift)
                .attr("y", -curVizObj.view.crop_info.up_shift);          

            // SITE SVG GROUPS

            var sampleGs = viewSVG.append("g")
                .attr("class", "sampleGs")
                .selectAll(".sampleG")
                .data(curVizObj.data.samples)
                .enter().append("g")
                .attr("class", function(d) { return "sampleG sample_" + d.sample_id.replace(/ /g,"_")});

            // PLOT CIRCLE BORDER

            viewSVG.append("circle")
                .attr("cx", dim.viewDiameter/2)
                .attr("cy", dim.viewDiameter/2)
                .attr("r", dim.viewDiameter/2 - 4)
                .attr("fill", "none")
                .attr("stroke", "#F4F3F3")
                .attr("stroke-width", "5px");

            // PLOT LEGEND GENOTYPE TREE

            // tree title
            viewSVG.append("text")
                .attr("class", "legendTitle")
                .attr("x", dim.legendWidth/2) 
                .attr("y", 22)
                .attr("text-anchor", "middle")
                .attr("font-family", "Arial")
                .attr("font-size", dim.legendTitleHeight)
                .attr("color", dim.legendTitleColour)
                .attr("transform", "translate(" + dim.viewDiameter + ",0)")
                .text("Phylogeny");

            // d3 tree layout
            var treeLayout = d3.layout.tree()           
                    .size([dim.legendTreeWidth - dim.legendNode_r*2, 
                        dim.legendTreeWidth - dim.legendNode_r*2]);

            // get nodes and links
            var root = $.extend({}, curVizObj.data.treeStructure), // copy tree into new variable
                nodes = treeLayout.nodes(root), 
                links = treeLayout.links(nodes);   

            // swap x and y direction
            nodes.forEach(function(node) {
                node.tmp = node.y;
                node.y = node.x + dim.legendNode_r + dim.legendTitleHeight; 
                node.x = node.tmp + dim.legendNode_r; 
                delete node.tmp; 
            });

            // create links
            curVizObj.link_ids = [];
            viewSVG.append("g")
                .attr("class","gtypeTreeLinkG")
                .attr("transform", "translate(" + dim.viewDiameter + ",0)")
                .selectAll(".legendTreeLink")                  
                .data(links)                   
                .enter().append("path")                   
                .attr("class", function(d) { 
                    d.link_id = "treeLink_" + d.source.id + "_" + d.target.id;
                    curVizObj.link_ids.push(d.link_id);
                    return "legendTreeLink " + d.link_id;
                })
                .attr('stroke', dim.neutralGrey)
                .attr('fill', 'none')
                .attr('stroke-width', '2px')               
                .attr("d", function(d) {
                    return _elbow(d);
                })
                .on("mouseover", function(d) {
                    if (_checkForSelections(curVizObj)) {
                        // shade legend tree nodes & links
                        _shadeLegend(curVizObj);

                        // shade view
                        _shadeMainView(curVizObj);

                        // highlight all elements downstream of link
                        _propagatedEffects(curVizObj, d.link_id, curVizObj.link_ids, "downstream");
                    }
                })
                .on("mouseout", function() {
                    if (_checkForSelections(curVizObj)) {
                        _resetView(curVizObj);
                    }
                });
            
            // create nodes
            var cols = curVizObj.view.colour_assignment;
            viewSVG.append("g")
                .attr("class", "gtypeTreeNodeG")
                .attr("transform", "translate(" + dim.viewDiameter + ",0)")
                .selectAll(".legendTreeNode")                  
                .data(nodes)                   
                .enter()
                .append("circle")     
                .attr("class", function(d) {
                    return "legendTreeNode clone_" + d.id;
                })
                .attr("cx", function(d) { return d.x; })
                .attr("cy", function(d) { return d.y; })           
                .attr("fill", function(d) { 
                    if (d.id == dim.phantomRoot) {
                        return "none";
                    }
                    return cols[d.id]; 
                })
                .attr("stroke", function(d) { 
                    if (d.id == dim.phantomRoot) {
                        return "none";
                    }
                    return cols[d.id]; 
                })
                .attr("r", dim.legendNode_r)
                .on("mouseover", function(d) {
                    // if we're selecting nodes
                    if (dim.nClickedNodes > 0) {
                        // highlight node in the legend
                        d3.select("#" + view_id)
                            .select(".legendTreeNode.clone_" + d.id)
                            .attr("fill-opacity", 1)
                            .attr("stroke-opacity", 1);
                    }

                    // if there are no selections
                    if (_checkForSelections(curVizObj)) {
                        // shade view & legend
                        _shadeMainView(curVizObj);
                        _shadeLegend(curVizObj);

                        // highlight this clone
                        _legendCloneHighlight(curVizObj, d.id, true);
                    }
                })
                .on("mouseout", function(d) {
                    // if we're selecting nodes, but we haven't clicked this one yet
                    if ((dim.nClickedNodes > 0) && (_.uniq(dim.curCloneIDs).indexOf(d.id) == -1)) {
                        // unhighlight this node in the legend
                        d3.select("#" + view_id)
                            .select(".legendTreeNode.clone_" + d.id)
                            .attr("fill-opacity", dim.shadeAlpha)
                            .attr("stroke-opacity", dim.shadeAlpha);
                    }
                    if (_checkForSelections(curVizObj)) {
                        // remove clonal prevalence text
                        d3.select("#" + view_id).selectAll(".clonalPrev").remove();

                        // reset view
                        _resetView(curVizObj);
                    }
                })
                .on("click", function(d) {
                    // if there are mutations
                    if (curVizObj.userConfig.mutations[0] != "NA") {

                        dim.selectOn = true;
                        dim.nClickedNodes++; // increment the number of clicked nodes

                        // remove any clonal prevalence plotting from the node mouseover
                        d3.select("#" + curVizObj.view_id).selectAll(".clonalPrev").remove();
                        // remove any mutation prevalence plotting from the node mouseover
                        d3.select("#" + curVizObj.view_id).selectAll(".mutationPrevalences").remove();
                        // reset any general anatomic marks
                        d3.select("#" + curVizObj.view_id).selectAll(".generalMark").attr("fill", "#CBCBCB");

                        // get data for this clone
                        var filtered_muts = 
                            _.filter(curVizObj.data.mutations, function(mut) { return mut.clone_id == d.id; });

                        // if there's no data for this clone, add a row of "None"
                        if (filtered_muts.length == 0) { 
                            filtered_muts = [{}];
                            dim.mutationColumns.forEach(function(col) {
                                filtered_muts[0][col.data] = (col.data == "empty") ? "" : "None";
                            })
                        }
                        filtered_muts[0]["clone_id"] = d.id;

                        // if it's the first clicked node
                        if (dim.nClickedNodes == 1) {
                            // delete existing data table
                            d3.select("#" + curVizObj.view_id + "_mutationTable" + "_wrapper").remove();   

                            // plot filtered data table
                            _makeMutationTable(curVizObj, curVizObj.view.mutationTableDIV, filtered_muts,
                                dim.mutationTableHeight); 

                            // shade view & legend
                            _shadeMainView(curVizObj);
                            _shadeLegend(curVizObj);  
                        }
                        // otherwise
                        else {
                            // add to existing data table
                            var table = $("#" + curVizObj.view_id + "_mutationTable").DataTable();
                            table.rows.add(filtered_muts).draw(false);

                            // add this clone id to the list of clone ids in the mutation table
                            dim.curCloneIDs = dim.curCloneIDs.concat(_.pluck(filtered_muts, "clone_id"));

                            // plot clone svg circles in mutation table
                            _addCloneSVGsToTable(curVizObj, dim.curCloneIDs);
                        }

                        // highlight this clone
                        _legendCloneHighlight(curVizObj, d.id, false);

                        d3.event.stopPropagation();
                    }
                });

            // PLOT ANATOMY IN LEGEND

            // anatomy title
            viewSVG.append("text")
                .attr("class", "legendTitle")
                .attr("x", dim.legendWidth/2) 
                .attr("y", dim.legend_image_top_l.y - dim.legendTitleHeight)
                .attr("text-anchor", "middle")
                .attr("transform", "translate(" + dim.viewDiameter + ",0)")
                .attr("color", dim.legendTitleColour)
                .attr("font-family", "Arial")
                .attr("font-size", dim.legendTitleHeight)
                .text("Anatomy");

            // anatomy image
            viewSVG.append("image")
                .attr("xlink:href", dim.image_ref)
                .attr("x", dim.legend_image_top_l.x)
                .attr("y", dim.legend_image_top_l.y)
                .attr("transform", "translate(" + dim.viewDiameter + ",0)")
                .attr("width", dim.legend_image_width)
                .attr("height", dim.legend_image_height)

            // anatomy region of interest
            viewSVG.append("circle")
                .attr("cx", dim.legend_image_top_l.x + curVizObj.view.crop_info.centre_prop.x*dim.legend_image_width)
                .attr("cy", dim.legend_image_top_l.y + curVizObj.view.crop_info.centre_prop.y*dim.legend_image_height)
                .attr("transform", "translate(" + dim.viewDiameter + ",0)")
                .attr("r", (curVizObj.view.crop_info.crop_width_prop/2) * dim.legend_image_width)
                .attr("stroke-width", "2px")
                .attr("stroke", dim.anatomicLineColour)
                .attr("fill", "none");

            // PLOT ANATOMIC MARKS FOR EACH SITE STEM (e.g. "Om", "ROv")

            viewSVG.append("g")
                .attr("class", "anatomicMarksG")
                .selectAll(".generalMark")
                .data(Object.keys(curVizObj.data.anatomic_locations))
                .enter()
                .append("circle")
                .attr("class", function(d) {
                    return "location_" + d + " generalMark";
                })
                .attr("cx", function(d) { return curVizObj.data.anatomic_locations[d]["cropped_coords"].x; })
                .attr("cy", function(d) { return curVizObj.data.anatomic_locations[d]["cropped_coords"].y; })
                .attr("r", dim.sampleMark_r)
                .attr("fill", "#CBCBCB")
                .attr("stroke-width", "1.5pxx")
                .attr("stroke", dim.anatomicLineColour)
                .on("mouseover", function(d) {
                    if (_checkForSelections(curVizObj)) {
                        // highlight this location
                        d3.select(this) 
                            .attr("fill", dim.anatomicLineColour);

                        // shade view
                        _shadeMainView(curVizObj);

                        // highlight all samples with this location
                        _highlightSites(curVizObj.data.anatomic_locations[d].sample_ids, curVizObj);
                    }
                })
                .on("mouseout", function(d) {
                    if (_checkForSelections(curVizObj)) {
                        _resetView(curVizObj);
                    }
                });

            // PLOT MIXTURE CLASSIFICATION

            var mixture_classes = {};
            curVizObj.data.samples.forEach(function(sample) {
                mixture_classes[sample.phyly] = mixture_classes[sample.phyly] || [];
                mixture_classes[sample.phyly].push({"sample_id": sample.sample_id, 
                                                    "sample_location": (sample.location)? sample.location.location_id : null});
            })

            // plot mixture classification title
            viewSVG.append("text")
                .attr("class", "MixtureLegendTitle legendTitle")
                .attr("x", dim.legendWidth/2) 
                .attr("y", dim.legend_mixture_top)
                .attr("dy", "+0.71em")
                .attr("text-anchor", "middle")
                .attr("color", dim.legendTitleColour)
                .attr("font-family", "Arial")
                .attr("transform", "translate(" + dim.viewDiameter + ",0)")
                .attr("font-size", dim.legendTitleHeight)
                .text("Mixture");
            viewSVG.append("text")
                .attr("class", "ClassificationLegendTitle legendTitle")
                .attr("x", dim.legendWidth/2) 
                .attr("y", dim.legend_mixture_top + dim.legendTitleHeight)
                .attr("dy", "+0.71em")
                .attr("text-anchor", "middle")
                .attr("font-family", "Arial")
                .attr("color", dim.legendTitleColour)
                .attr("transform", "translate(" + dim.viewDiameter + ",0)")
                .attr("font-size", dim.legendTitleHeight)
                .text("Classification");

            var mixtureClassLegendTitle_width = 
                d3.select("#" + view_id).select(".ClassificationLegendTitle").node().getBBox().width;
            var spacing_below_title = 5;
            Object.keys(mixture_classes).forEach(function(phyly, phyly_idx) {
                viewSVG.append("text")
                    .attr("class", "mixtureClass")
                    .attr("x", dim.legendWidth/2 - (mixtureClassLegendTitle_width/2)) 
                    .attr("y", function() {
                        var y = dim.legend_mixture_top + dim.legendTitleHeight*2 + spacing_below_title 
                                + phyly_idx*(dim.mixtureClassFontSize + 2);
                        return y;
                    })
                    .attr("dy", "+0.71em")
                    .attr("transform", "translate(" + dim.viewDiameter + ",0)")
                    .attr("fill", dim.neutralGrey)
                    .attr("font-family", "Arial")
                    .attr("font-size", dim.mixtureClassFontSize)
                    .text(function() { return " - " + phyly; })
                    .style("cursor", "default")
                    .on("mouseover", function() {
                        if (_checkForSelections(curVizObj)) {
                            var viewSVG = d3.select("#" + view_id);
                            var participating_samples = _.pluck(mixture_classes[phyly], "sample_id");

                            // shade view
                            _shadeMainView(curVizObj);

                            // highlight samples
                            _highlightSites(participating_samples, curVizObj);

                            // highlight general anatomic marks
                            var locations = _.uniq(_.pluck(mixture_classes[phyly], "sample_location"));
                            locations.forEach(function(location) {
                                d3.select("#" + view_id).select(".generalMark.location_"+location)
                                    .attr("fill", dim.anatomicLineColour);
                            });

                            // highlight only those links that participate in the mixture classification
                            viewSVG.selectAll(".treeLink").attr("stroke-opacty", 0);
                            participating_samples.forEach(function(participating_sample) {
                                viewSVG.selectAll(".treeLink.sample_" + participating_sample)
                                    .attr("stroke-opacity", dim.shadeAlpha);
                                viewSVG.selectAll(".mixtureClassTreeLink.sample_"+participating_sample)
                                    .attr("stroke-opacity", 1);                        
                            });
                        }
                    })
                    .on("mouseout", function(d) {
                        if (_checkForSelections(curVizObj)) {
                            _resetView(curVizObj);
                        }
                    });
            });

            // MUTATION TABLE

            // if mutations are specified by the user
            if (curVizObj.userConfig.mutations != "NA") {

                // make the table
                _makeMutationTable(curVizObj, curVizObj.view.mutationTableDIV, curVizObj.data.mutations,
                    dim.mutationTableHeight);
            }

            // FOR EACH SITE

            curVizObj.data.sample_ids.forEach(function(sample, sample_idx) {

                // PLOT SITE-SPECIFIC ELEMENTS (oncoMix, tree, title, anatomic lines, anatomic marks)
                _plotSite(curVizObj, sample, drag);            
            });



        }); // end when statement        
    },

    resize: function(el, width, height, instance) {

    }

});

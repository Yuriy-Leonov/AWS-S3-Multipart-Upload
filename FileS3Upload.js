(function() {
    /**
    @param {Object} [config]
    @constructor
    */
    var FileS3Upload = function(config){
        //  config should be object and contain following:
        //
        //  Mandatory:
        //
        //  - aws_url: 'https://mybucket.s3.amazonaws.com/'
        //
        //  - file_name: 'ex.txt'
        //      Name will be saved for file in s3
        //
        //  - file: $('#input_file')[0].files[0] or something like this :)
        //
        //  - auth_url: 'http://my.com/auth_sign'
        //      URL on your server where is possible get signature for request
        //
        //      e.x.backend function on python(django):
        //      def auth_sign(request):
        //          to_sign = request.GET.get('to_sign')  # 'POST\n\n\n\nx-amz-date:Tue, 01 Sep 2015 13:47:40 GMT\n/mybucket/name_file.txt?uploads'
        //          signature = base64.b64encode(hmac.new(AWS_S3_SECRET_ACCESS_KEY, to_sign, hashlib.sha1).digest())
        //          return HttpResponse(signature)
        //
        //  - bucket: 'mybucket'
        //
        //  - aws_key_id: 'AKIAJ572SSBCX7IKLMVQ'
        //
        //  - auth_url_headers: {'any': 'for your backend'}
        //      This headers will be added in GET request on "auth_url"
        //      It's required if your backend requires any mandatory header
        //
        //  Optional:
        //
        //  - partSize: integer
        //      Size for one part(blob) in byte
        //
        //  [successful callbacks]
        //  - on_get_upload_id: function(xhr, uploadId){}
        //      Fires when uploadId is got
        //      Takes xhr and uploadId which was provided by s3
        //
        //  - on_part_upload: function(xhr, ETag, part_number){}
        //      Fires when part is uploaded on s3
        //      Takes:
        //        xhr
        //        ETag -  which was provided by s3 in header "ETag"
        //        part_number - sequence number of part
        //
        //  - on_multipart_upload_complete: function(xhr)
        //      Fires when multipart upload is complete
        //
        //  - on_progress: function(total, loaded)
        //      Fires when part is uploaded
        //
        //  [common errors]
        //  - not_supported_error: function(){}
        //      It will be called if FileS3Upload is unsupported for current browser
        //      Doesn't take any arguments
        //
        //  - on_network_error: function(xhr){}
        //      Fires when there is a failure on the network level
        //      Placed in xhr.onerror
        //
        //  - on_non_200_error: function(xhr){}
        //      It will be called if response doesn't have 200 status
        //      If specific error isn't specified
        //
        //  [specific errors]
        //  If this type error is specified then common error won't be called in certain place
        //  - on_auth_error: function(xhr){}
        //      It will be called if response on "auth_url" doesn't have 200 status
        //      Takes one argument "xhr"
        //
        //  - on_getting_upload_id_error: function(xhr){}
        //      It will be called if response on "aws_url" doesn't have 200 status
        //      On step when uploadId should be taken
        //      Takes one argument "xhr"
        //
        //  - on_absence_upload_id_error: function(xhr){}
        //      It will be called if response on "aws_url" has 200 status
        //      But doesn't contain <UploadId\>...<\/UploadId\> in body response
        //      Takes one argument "xhr"
        //
        //  - on_send_part_error: function(xhr){}
        //      It will be called if response on "aws_url" doesn't have 200 status
        //      On step when part(blob) is sent to aws
        //      Takes one argument "xhr"
        //
        //  - on_complete_multipart_error: function(xhr){}
        //      It will be called if response on "aws_url" doesn't have 200 status
        //      On step when request contains data for completing multipart upload
        //      Takes one argument "xhr"
        //


        this.supported = !((typeof(File)=='undefined') || (typeof(Blob)=='undefined') ||
            !(!!Blob.prototype.webkitSlice || !!Blob.prototype.mozSlice || Blob.prototype.slice));

        if(!this.supported){
            throw 'FileS3Upload is unsupported for you browser';
        }


        var self = this,
            required_keys = [
                'aws_url',
                'file_name',
                'file',
                'auth_url',
                'bucket',
                'aws_key_id',
                'auth_url_headers'
            ],
            missed_keys = [],
            all_keys = [],
            key,
            ind;
        self.config = extend(
            {partSize: 6 * 1024 * 1024},  // 6 Mb
            config || {}
        );


        // "Check mandatory keys in config"
        for (key in self.config){
            if (self.config.hasOwnProperty(key)) {
                all_keys.push(key);
            }
        }
        for (ind in required_keys){
            if(all_keys.indexOf(required_keys[ind]) == -1){
                missed_keys.push(required_keys[ind]);
            }
        }
        if(missed_keys.length > 0){
            self.config.not_supported_error && self.config.not_supported_error();
            throw 'Missed keys in config: ' + missed_keys.join(', ');
        }
        // END "Check mandatory keys in config"

        self.config.file_name = encodeURIComponent(self.config.file_name);
        self.config.file.name = encodeURIComponent(self.config.file.name);
        self.count_of_parts = Math.ceil(self.config.file.size / self.config.partSize) || 1;
        self.total = self.config.file.size;
        self.loaded = 0;
        self.current_part = 1;
        self.parts = [];

        log('Total count of parts = ' + self.count_of_parts);

        self._sign_request = function(method, suffix_to_sign, contentType, success_callback){
            var xhr = self.getXmlHttp(),
                to_sign,
                signature,
                date_gmt = new Date().toUTCString();
            to_sign = method + '\n\n' + contentType +
                '\n\nx-amz-date:' + date_gmt + '\n/' +
                self.config.bucket + '/' +
                self.config.file_name + suffix_to_sign;
            xhr.open('GET', joinUrlElements(self.config.auth_url, '/?to_sign=' + encodeURIComponent(to_sign)));
            for (var key in self.config.auth_url_headers){
                if (self.config.auth_url_headers.hasOwnProperty(key)) {
                    xhr.setRequestHeader(key, self.config.auth_url_headers[key]);
                }
            }
            xhr.onreadystatechange = function(){
                if (xhr.readyState == 4){
                    if (xhr.status == 200){
                        signature = xhr.response;
                        success_callback && success_callback(signature, date_gmt);
                    } else {
                        self.config.on_non_200_error && self.config.on_non_200_error(xhr) ||
                        self.config.on_auth_error && self.config.on_auth_error(xhr);
                    }
                }
            };
            xhr.send(null);
        };

        self.init_multipart_upload = function(){
            self._sign_request('POST', '?uploads', '', function(signature, date_gmt){
                self._get_upload_id(signature, date_gmt); // as result we have self.UploadId
            });
        };

        self._send_part = function(){
            var from_byte,
                to_byte,
                suffix_to_sign,
                blob;
            if(self.parts.length == self.count_of_parts){
                suffix_to_sign = '?uploadId=' + self.UploadId;
                self._sign_request('POST', suffix_to_sign, 'application/xml; charset=UTF-8', function(signature, date_gmt){
                    self.complete_multipart_upload(signature, date_gmt, suffix_to_sign);
                });
                log('Try to complete');
                return;
            }
            from_byte = (self.current_part - 1) * self.config.partSize;  // self.current_part starts from 1
            to_byte = self.current_part * self.config.partSize;
            blob = self.config.file.slice(from_byte,  to_byte);
            suffix_to_sign = '?partNumber=' + self.current_part + '&uploadId=' + self.UploadId;
            self._sign_request('PUT', suffix_to_sign, '', function(signature, date_gmt){
                self._send_blob(signature, date_gmt, suffix_to_sign, blob);
            });
        };

        self._send_blob = function(signature, date_gmt, suffix, blob){
            var xhr = self.getXmlHttp(),
                ETag;
            xhr.open('PUT', joinUrlElements(self.config.aws_url, '/' + self.config.file_name + suffix));
            xhr.setRequestHeader('Authorization', 'AWS ' + self.config.aws_key_id + ':' + signature);
            xhr.setRequestHeader('x-amz-date', date_gmt);

            if(xhr.upload){
                xhr.upload.addEventListener("progress", function(prog) {
//                    value = ~~((prog.loaded / prog.total) * 100);
                    self.config.on_progress && self.config.on_progress(self.total, self.loaded + prog.loaded);
                }, false);
            }
            xhr.onreadystatechange = function(){
                if (xhr.readyState == 4){
                    if (xhr.status == 200){
                        ETag = xhr.getResponseHeader('ETag');
                        log('ETag = ' + ETag + ' For part #' + self.current_part);
                        self.parts.push(ETag);

                        self.loaded += blob.size;
                        self.config.on_progress && self.config.on_progress(self.total, self.loaded);
                        // put it here becouse in future we should keep for unuploaded parts

                        self.config.on_part_upload && self.config.on_part_upload(xhr, ETag, self.current_part);
                        self.current_part += 1;
                        setTimeout(function(){  // to avoid recursion
                            self._send_part();
                        }, 50);
                    } else {
                        self.config.on_non_200_error && self.config.on_non_200_error(xhr) ||
                        self.config.on_send_part_error && self.config.on_send_part_error(xhr);
                    }
                }
            };
            xhr.send(blob);
        };

        self._get_upload_id = function(signature, date_gmt){
            var xhr = self.getXmlHttp(),
                uploadId;
            xhr.open('POST', joinUrlElements(self.config.aws_url, '/' + self.config.file_name + '?uploads'));
            xhr.setRequestHeader('Authorization', 'AWS ' + self.config.aws_key_id + ':' + signature);
            xhr.setRequestHeader('x-amz-date', date_gmt);
            xhr.onreadystatechange = function(){
                if (xhr.readyState == 4){
                    if (xhr.status == 200){
                        uploadId = xhr.response.match(/<UploadId\>(.+)<\/UploadId\>/);
                        if (uploadId && uploadId[1]){
                            self.UploadId = uploadId[1];
                            log('Got UploadId: ' + self.UploadId);
                            self.config.on_get_upload_id && self.config.on_get_upload_id(xhr, self.UploadId);
                            setTimeout(function(){
                                self._send_part();
                            }, 50);
                        }else{
                            self.config.on_non_200_error && self.config.on_non_200_error(xhr) ||
                            self.config.on_absence_upload_id_error && self.config.on_absence_upload_id_error(xhr);
                        }
                    } else {
                        self.config.on_non_200_error && self.config.on_non_200_error(xhr) ||
                        self.config.on_getting_upload_id_error && self.config.on_getting_upload_id_error(xhr);
                    }
                }
            };
            xhr.send(null);
        };

        self.complete_multipart_upload = function(signature, date_gmt, suffix){
            var xhr = self.getXmlHttp(),
                completeDoc = '<CompleteMultipartUpload>';
            xhr.open('POST', joinUrlElements(self.config.aws_url, '/' + self.config.file_name + suffix));
            xhr.setRequestHeader('Authorization', 'AWS ' + self.config.aws_key_id + ':' + signature);
            xhr.setRequestHeader('Content-Type', 'application/xml; charset=UTF-8');
            xhr.setRequestHeader('x-amz-date', date_gmt);
            xhr.onreadystatechange = function(){
                if (xhr.readyState == 4){
                    if (xhr.status == 200){
                        log('END');
                        self.config.on_multipart_upload_complete && self.config.on_multipart_upload_complete(xhr);
                    } else {
                        self.config.on_non_200_error && self.config.on_non_200_error(xhr) ||
                        self.config.on_complete_multipart_error && self.config.on_complete_multipart_error(xhr);
                    }
                }
            };

            self.parts.forEach(function(ETag, partNumber){
                completeDoc += '<Part><PartNumber>' + (partNumber + 1) + '</PartNumber><ETag>' + ETag + '</ETag></Part>';
            });
            completeDoc += '</CompleteMultipartUpload>';
            xhr.send(completeDoc);
        };

        self.getXmlHttp = function(){
            var xmlhttp;
            try {
                xmlhttp = new ActiveXObject("Msxml2.XMLHTTP");
            } catch (e) {
                try {
                    xmlhttp = new ActiveXObject("Microsoft.XMLHTTP");
                } catch (E) {
                    xmlhttp = false;
                }
            }
            if (!xmlhttp && typeof XMLHttpRequest!='undefined') {
                xmlhttp = new XMLHttpRequest();
            }
            xmlhttp.onerror = function(){
                self.config.on_network_error && self.config.on_network_error(xhr);
            };
            return xmlhttp;
        };
    };
    function extend(obj1, obj2, obj3){

        if (typeof obj1 == 'undefined'){obj1 = {};}

        if (typeof obj3 == 'object'){
            for (var key in obj3){
              obj2[key]=obj3[key];
            }
        }

        for (var key2 in obj2){
            obj1[key2]=obj2[key2];
        }
            return obj1;
        }

    function joinUrlElements() {
        var re1 = new RegExp('^\\/|\\/$','g'),
            elts = Array.prototype.slice.call(arguments);
        return elts.map(function(element){return element.replace(re1,""); }).join('/');
    }

    function log(){
        try{
            console.log.apply(console, arguments);
        } catch (e){}
    }

    if (typeof module !== 'undefined' && module.exports) {
        module.exports = FileS3Upload;
    } else if (typeof window !== 'undefined') {
        window.FileS3Upload = FileS3Upload;
    }
})();


(function() {
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
        //      def auth_sign(request:
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


        this.supported = !((typeof(File)=='undefined') || (typeof(Blob)=='undefined') ||
            !(!!Blob.prototype.webkitSlice || !!Blob.prototype.mozSlice || Blob.prototype.slice));

        if(!this.supported){
            throw 'FileS3Upload is unsupported for you browser';
        }


        var self = this,
            files = [],
            con = extend({
                maxConcurrentParts: 1,
                partSize: 6 * 1024 * 1024  // 6 Mb
            }, config || {}),
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
        self.config = con;

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
            throw 'Missed keys in config: ' + missed_keys.join(', ');
        }
        // END "Check mandatory keys in config"

        self.config.file_name = encodeURIComponent(self.config.file_name);
        self.config.file.name = encodeURIComponent(self.config.file.name);
        self.count_of_parts = Math.ceil(self.config.file.size / self.config.partSize) || 1;
        self.current_part = 1;
        self.parts = [];

        self._sign_request = function(method, suffix_to_sign, contentType, success_callback){
            var xhr = getXmlHttp(),
                to_sign,
                signature,
                date_gmt = new Date().toUTCString();
//            contentType: 'application/xml; charset=UTF-8'
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
                        debugger;
                    }
                }
            };
            xhr.onerror = function(){debugger;};
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
            var xhr = getXmlHttp(),
                eTag;
            xhr.open('PUT', joinUrlElements(self.config.aws_url, '/' + self.config.file_name + suffix));
            xhr.setRequestHeader('Authorization', 'AWS ' + self.config.aws_key_id + ':' + signature);
            xhr.setRequestHeader('x-amz-date', date_gmt);
            xhr.onreadystatechange = function(){
                if (xhr.readyState == 4){
                    if (xhr.status == 200){
                        eTag = xhr.getResponseHeader('ETag');
                        log('ETag = ' + eTag + ' For part #' + self.current_part);
                        self.parts.push(eTag);
                        self.current_part += 1;
                        setTimeout(function(){  // to avoid recursion
                            self._send_part();
                        }, 50);
                    } else {
                        debugger;  // error
                    }
                }
            };
            xhr.send(blob);
        };

        self._get_upload_id = function(signature, date_gmt){
            var xhr = getXmlHttp(),
                match;
            xhr.open('POST', joinUrlElements(self.config.aws_url, '/' + self.config.file_name + '?uploads'));
            xhr.setRequestHeader('Authorization', 'AWS ' + self.config.aws_key_id + ':' + signature);
            xhr.setRequestHeader('x-amz-date', date_gmt);
            xhr.onreadystatechange = function(){
                if (xhr.readyState == 4){
                    if (xhr.status == 200){
                        match = xhr.response.match(/<UploadId\>(.+)<\/UploadId\>/);
                        if (match && match[1]){
                            self.UploadId = match[1];
                            log('Got match: ' + self.UploadId);
                            setTimeout(function(){
                                self._send_part();
                            }, 50);
                        }else{
                            debugger;  // error
                        }
                    } else {
                        debugger;  // error
                    }
                }
            };
            xhr.send(null);
        };

        self.complete_multipart_upload = function(signature, date_gmt, suffix){
            var xhr = getXmlHttp(),
                completeDoc = '<CompleteMultipartUpload>';
            xhr.open('POST', joinUrlElements(self.config.aws_url, '/' + self.config.file_name + suffix));
            xhr.setRequestHeader('Authorization', 'AWS ' + self.config.aws_key_id + ':' + signature);
            xhr.setRequestHeader('Content-Type', 'application/xml; charset=UTF-8');
            xhr.setRequestHeader('x-amz-date', date_gmt);
            xhr.onreadystatechange = function(){
                if (xhr.readyState == 4){
                    if (xhr.status == 200){
                        log('END');
                    } else {
                        debugger;  // error
                    }
                }
            };

            self.parts.forEach(function(eTag, partNumber){
                completeDoc += '<Part><PartNumber>' + (partNumber + 1) + '</PartNumber><ETag>' + eTag + '</ETag></Part>';
            });
            completeDoc += '</CompleteMultipartUpload>';

            xhr.send(completeDoc);
        }
    };

    function getXmlHttp(){
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
        return xmlhttp;
    }

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


